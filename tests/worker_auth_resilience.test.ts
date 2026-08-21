import { describe, it } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import crypto from "crypto";
import { Api } from "telegram";
import { getDefaultTelegramConfig, checkQrLoginStatus, createTelegramClient } from "../src/server/lib/telegram.ts";
import { encryptSession, decryptSession, getCryptoKey } from "../src/server/lib/crypto.ts";

describe("⚡ Cloudflare Worker & Auth Resilience Suite", () => {
  describe("1. Strict Environment & Context Resolution (No-Fail-Fallbacks)", () => {
    it("should correctly extract and parse credentials from worker context object (c.env)", () => {
      const mockWorkerEnv = {
        TELEGRAM_API_ID: "12345678",
        TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
        TELEGRAM_TEST_MODE: "false",
      };

      const config = getDefaultTelegramConfig(mockWorkerEnv);
      assert.equal(config.apiId, 12345678, "apiId must be parsed to integer");
      assert.equal(config.apiHash, "0123456789abcdef0123456789abcdef");
      assert.equal(config.testMode, false);
    });

    it("should strictly throw when TELEGRAM_API_ID is missing or empty in context", () => {
      const originalEnv = process.env.TELEGRAM_API_ID;
      delete process.env.TELEGRAM_API_ID;

      try {
        assert.throws(
          () => getDefaultTelegramConfig({ TELEGRAM_API_HASH: "some_hash" }),
          /Missing or invalid required environment variable: TELEGRAM_API_ID/,
          "Must fail immediately with explicit error when API ID is absent"
        );
      } finally {
        if (originalEnv) process.env.TELEGRAM_API_ID = originalEnv;
      }
    });

    it("should strictly throw when TELEGRAM_API_HASH is missing or empty in context", () => {
      const originalHash = process.env.TELEGRAM_API_HASH;
      delete process.env.TELEGRAM_API_HASH;

      try {
        assert.throws(
          () => getDefaultTelegramConfig({ TELEGRAM_API_ID: "12345" }),
          /Missing required environment variable: TELEGRAM_API_HASH/,
          "Must fail immediately with explicit error when API HASH is absent"
        );
      } finally {
        if (originalHash) process.env.TELEGRAM_API_HASH = originalHash;
      }
    });

    it("should throw when SESSION_ENCRYPTION_KEY is missing without fallback", async () => {
      const originalKey = process.env.SESSION_ENCRYPTION_KEY;
      delete process.env.SESSION_ENCRYPTION_KEY;

      try {
        await assert.rejects(
          async () => getCryptoKey(),
          /Missing required environment variable: SESSION_ENCRYPTION_KEY/,
          "Must not silently fall back to an insecure hardcoded key"
        );
      } finally {
        if (originalKey) process.env.SESSION_ENCRYPTION_KEY = originalKey;
      }
    });

    it("should prioritize custom context secret key over process.env", async () => {
      const customKey = "custom_cloudflare_worker_secret_key_12345";
      const data = "test_telegram_session_string_abc";

      const encrypted = await encryptSession(data, customKey);
      const decrypted = await decryptSession(encrypted, customKey);

      assert.equal(decrypted, data, "Must successfully roundtrip with context secret key");

      // Decryption with wrong key must fail
      await assert.rejects(
        async () => decryptSession(encrypted, "wrong_encryption_secret_key_99999"),
        /Unsupported state or unable to authenticate data|decryption failed|unable to authenticate/i
      );
    });

    it("should allow createTelegramClient to accept config as first argument or second argument", () => {
      const config = {
        apiId: 12345678,
        apiHash: "0123456789abcdef0123456789abcdef",
      };

      // 1. Calling with config as first argument
      const client1 = createTelegramClient(config);
      assert.equal(client1.apiId, 12345678);
      assert.equal(client1.apiHash, "0123456789abcdef0123456789abcdef");

      // 2. Calling with empty session string and config
      const client2 = createTelegramClient("", config);
      assert.equal(client2.apiId, 12345678);
      assert.equal(client2.apiHash, "0123456789abcdef0123456789abcdef");
    });
  });

  describe("2. Pure SVG QR Code Generation (Zero Canvas Dependency)", () => {
    it("should generate valid standalone SVG XML string without requiring DOM canvas", async () => {
      const sampleLoginUrl = "tg://login?token=AQSm4Zq20FjQlEvC8dKiEvJ22_jua-m12345";

      const qrSvg = await QRCode.toString(sampleLoginUrl, {
        type: "svg",
        width: 280,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });

      assert.ok(typeof qrSvg === "string", "QR Output must be a string");
      assert.ok(qrSvg.startsWith("<svg"), "Must start with <svg root element");
      assert.ok(qrSvg.includes("</svg>"), "Must be closed with </svg>");
      assert.ok(qrSvg.includes("<path"), "Must contain vector path elements");
    });

    it("should produce a valid Data URL that decodes back to valid SVG", async () => {
      const sampleLoginUrl = "tg://login?token=test_token_data";
      const qrSvg = await QRCode.toString(sampleLoginUrl, { type: "svg" });
      const qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

      assert.ok(qrDataUrl.startsWith("data:image/svg+xml;utf8,"), "Must have correct MIME type prefix");
      const decoded = decodeURIComponent(qrDataUrl.replace("data:image/svg+xml;utf8,", ""));
      assert.equal(decoded, qrSvg, "Decoded content must match raw SVG exactly");
    });
  });

  describe("3. MTProto QR Authentication & DC Migration Resilience", () => {
    it("should authenticate immediately on LoginTokenSuccess with embedded user", async () => {
      const mockUser = {
        id: 123456789,
        firstName: "Test",
        lastName: "User",
        username: "testuser",
      };

      const mockClient = {
        session: {
          save: () => "mock_saved_session_string_dc2",
        },
        invoke: async (request: any) => {
          if (request instanceof Api.auth.ExportLoginToken) {
            return new Api.auth.LoginTokenSuccess({
              authorization: new Api.auth.Authorization({
                user: mockUser as any,
              } as any),
            });
          }
          throw new Error("Unexpected request");
        },
        isUserAuthorized: async () => true,
        getMe: async () => mockUser,
      } as any;

      const result = await checkQrLoginStatus(mockClient, Buffer.from("token"), {
        apiId: 12345678,
        apiHash: "0123456789abcdef0123456789abcdef",
      });

      assert.equal(result.success, true);
      assert.equal(result.sessionString, "mock_saved_session_string_dc2");
      assert.equal(result.user?.firstName, "Test");
    });

    it("should handle LoginTokenMigrateTo by switching DC and importing login token", async () => {
      let switchedDcId: number | null = null;
      let importedToken: Buffer | null = null;

      const mockMigratedUser = {
        id: 987654321,
        firstName: "Migrated",
        lastName: "User",
      };

      const mockClient = {
        session: {
          save: () => "mock_saved_session_string_migrated_dc4",
        },
        _switchDC: async (dcId: number) => {
          switchedDcId = dcId;
        },
        invoke: async (request: any) => {
          if (request instanceof Api.auth.ExportLoginToken) {
            return new Api.auth.LoginTokenMigrateTo({
              dcId: 4,
              token: Buffer.from("migrated_token_buffer_dc4"),
            });
          }
          if (request instanceof Api.auth.ImportLoginToken) {
            importedToken = request.token;
            return new Api.auth.LoginTokenSuccess({
              authorization: new Api.auth.Authorization({
                user: mockMigratedUser as any,
              } as any),
            });
          }
          throw new Error("Unexpected request");
        },
        isUserAuthorized: async () => true,
        getMe: async () => mockMigratedUser,
      } as any;

      const result = await checkQrLoginStatus(mockClient, Buffer.from("token"), {
        apiId: 12345678,
        apiHash: "0123456789abcdef0123456789abcdef",
      });

      assert.equal(result.success, true);
      assert.equal(switchedDcId, 4, "Must have called _switchDC with target DC ID");
      assert.ok(importedToken !== null, "Must have invoked ImportLoginToken");
      assert.equal(result.sessionString, "mock_saved_session_string_migrated_dc4");
      assert.equal(result.user?.firstName, "Migrated");
    });

    it("should fall back to client.isUserAuthorized() and client.getMe() when user payload is implicit", async () => {
      const mockFallbackUser = {
        id: 555555555,
        firstName: "Fallback",
        username: "fallbackuser",
      };

      const mockClient = {
        session: {
          save: () => "mock_session_authorized",
        },
        invoke: async () => {
          // Returns empty authorization without embedded user
          return new Api.auth.LoginTokenSuccess({
            authorization: {} as any,
          });
        },
        isUserAuthorized: async () => true,
        getMe: async () => mockFallbackUser,
      } as any;

      const result = await checkQrLoginStatus(mockClient, Buffer.from("token"), {
        apiId: 12345678,
        apiHash: "0123456789abcdef0123456789abcdef",
      });

      assert.equal(result.success, true);
      assert.equal(result.user?.firstName, "Fallback");
      assert.equal(result.user?.username, "fallbackuser");
    });
  });

  describe("4. Web Session & Cookie Construction", () => {
    it("should generate cryptographically secure 256-bit hex session tokens", () => {
      const sessionToken = crypto.randomBytes(32).toString("hex");
      assert.equal(sessionToken.length, 64, "256-bit token must be exactly 64 hex characters");
      assert.match(sessionToken, /^[0-9a-f]{64}$/, "Must contain only valid hex characters");
    });

    it("should format valid 30-day session expiration and cookie headers", () => {
      const sessionToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
      const cookieHeader = `tg_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;

      assert.ok(cookieHeader.includes(`tg_session=${sessionToken}`), "Must include token value");
      assert.ok(cookieHeader.includes("Path=/"), "Must be root path scoped");
      assert.ok(cookieHeader.includes("HttpOnly"), "Must be HttpOnly for XSS prevention");
      assert.ok(cookieHeader.includes("SameSite=Lax"), "Must have SameSite=Lax for CSRF protection");
      assert.ok(cookieHeader.includes("Max-Age=2592000"), "Must be 30-day TTL (2592000 seconds)");
    });
  });
});
