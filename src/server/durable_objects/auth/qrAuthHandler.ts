import QRCode from "qrcode";
import crypto from "crypto";
import { getDb } from "../../lib/db.ts";
import { encryptSession } from "../../lib/crypto.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";
import {
  createTelegramClient,
  getDefaultTelegramConfig,
  startQrLogin,
  checkQrLoginStatus,
} from "../../lib/telegram.ts";
import type { ActiveSessionEntry } from "../common/types.ts";

export class QrAuthHandler {
  activeSessions: Map<string, ActiveSessionEntry>;
  env: any;

  constructor(env: any) {
    this.env = env;
    this.activeSessions = new Map();
  }

  async handleWebSocket(ws: WebSocket, envObj?: any) {
    let client: any = null;
    let isCancelled = false;

    ws.addEventListener("close", () => {
      isCancelled = true;
      try {
        if (client) client.disconnect();
      } catch {}
    });

    ws.addEventListener("error", () => {
      isCancelled = true;
      try {
        if (client) client.disconnect();
      } catch {}
    });

    try {
      const targetEnv = envObj || this.env;
      const config = getDefaultTelegramConfig(targetEnv);
      client = createTelegramClient(config);
      await client.connect();

      const user = await client.signInUserWithQrCode(
        { apiId: config.apiId, apiHash: config.apiHash },
        {
          qrCode: async ({ token, expires }: { token: Buffer; expires: number }) => {
            if (isCancelled) return;
            const tokenBase64Url = Buffer.from(token).toString("base64url");
            const tgUrl = `tg://login?token=${tokenBase64Url}`;

            const qrSvg = await QRCode.toString(tgUrl, {
              type: "svg",
              width: 280,
              margin: 2,
              color: { dark: "#000000", light: "#ffffff" },
            });
            const qrImageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

            try {
              ws.send(
                JSON.stringify({
                  type: "qr",
                  qrUrl: tgUrl,
                  qrImage: qrImageDataUrl,
                  expires,
                })
              );
            } catch {}
          },
          onError: async (err: Error) => {
            console.error("[TelegramAuthDO WS Error]:", err);
            if (!isCancelled) {
              try {
                ws.send(JSON.stringify({ type: "error", error: err.message || "Authentication error" }));
              } catch {}
            }
            return true;
          },
        }
      );

      if (user && !isCancelled) {
        const sessionString = (client.session as any).save();
        const db = getDb(this.env?.DB);
        const telegramUserId = (user as any).id?.toString() || (user as any).id;
        const displayName =
          [(user as any).firstName, (user as any).lastName].filter(Boolean).join(" ") ||
          (user as any).username ||
          "Telegram User";

        // Dual-Key Zero-Knowledge Token Generation
        const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
        const encryptedSession = await encryptSession(
          sessionString,
          this.env?.SESSION_ENCRYPTION_KEY,
          clientSecret
        );

        let dbUser = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
        const userId = dbUser?.id || crypto.randomUUID();

        if (!dbUser) {
          await db.run(
            "INSERT INTO users (id, telegram_user_id, display_name, session_string) VALUES (?, ?, ?, ?)",
            [userId, telegramUserId, displayName, encryptedSession]
          );
        } else {
          await db.run(
            "UPDATE users SET display_name = ?, session_string = ? WHERE id = ?",
            [displayName, encryptedSession, userId]
          );
        }

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await db.run(
          "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
          [sessionId, userId, expiresAt]
        );

        try {
          ws.send(
            JSON.stringify({
              type: "authenticated",
              sessionToken,
              user: {
                id: userId,
                telegramUserId,
                displayName,
              },
            })
          );
        } catch {}
      }
    } catch (err: any) {
      console.error("[TelegramAuthDO WS Exception]:", err);
      if (!isCancelled) {
        try {
          ws.send(JSON.stringify({ type: "error", error: err.message || "Failed to initialize login" }));
        } catch {}
      }
    } finally {
      try {
        if (client) client.disconnect();
      } catch {}
    }
  }

  async handleQrHttp(envObj?: any, request?: Request): Promise<Response> {
    const qrId = crypto.randomUUID();
    const origin = request?.headers?.get("origin") || "*";
    try {
      const targetEnv = envObj || this.env;
      const { token, expires, client, tokenBuffer } = await startQrLogin(targetEnv);

      // Generate pure SVG QR code
      const qrSvg = await QRCode.toString(token, {
        type: "svg",
        width: 280,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      const qrImage = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

      this.activeSessions.set(qrId, {
        client,
        tokenBuffer,
        expires,
        qrImage,
        qrUrl: token,
      });

      return new Response(
        JSON.stringify({
          qrId,
          qrUrl: token,
          qrImage,
          expires,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    } catch (err: any) {
      const errMsg =
        err?.errorMessage ||
        err?.message ||
        (typeof err === "object" ? err.description || JSON.stringify(err) : String(err));
      console.error("[handleQrHttp Error]:", errMsg, err);
      return new Response(JSON.stringify({ error: errMsg || "Failed generating QR" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }
  }

  async handleCheckHttp(qrId?: string, envObj?: any, request?: Request): Promise<Response> {
    const origin = request?.headers?.get("origin") || "*";
    const isBuiltByShiva = origin.includes("builtbyshiva.com");
    const domainPart = isBuiltByShiva ? "; Domain=.builtbyshiva.com" : "";

    if (!qrId) {
      return new Response(JSON.stringify({ error: "qrId required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }

    const sessionEntry = this.activeSessions.get(qrId);
    if (!sessionEntry || !sessionEntry.client) {
      return new Response(JSON.stringify({ error: "Session expired or invalid" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }

    try {
      const targetEnv = envObj || this.env;
      const check = await checkQrLoginStatus(sessionEntry.client, sessionEntry.tokenBuffer as any, targetEnv);

      if (check.success && check.sessionString && check.user) {
        const db = getDb(targetEnv?.DB);
        const telegramUserId = check.user.id?.toString() || check.user.id;
        const displayName =
          [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") ||
          check.user.username ||
          "Telegram User";

        // Dual-Key Zero-Knowledge Token Generation
        const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
        const encryptedSession = await encryptSession(
          check.sessionString,
          targetEnv?.SESSION_ENCRYPTION_KEY,
          clientSecret
        );

        let dbUser = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
        const userId = dbUser?.id || crypto.randomUUID();

        if (!dbUser) {
          await db.run(
            "INSERT INTO users (id, telegram_user_id, display_name, session_string) VALUES (?, ?, ?, ?)",
            [userId, telegramUserId, displayName, encryptedSession]
          );
        } else {
          await db.run(
            "UPDATE users SET display_name = ?, session_string = ? WHERE id = ?",
            [displayName, encryptedSession, userId]
          );
        }

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await db.run(
          "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
          [sessionId, userId, expiresAt]
        );

        const cookieValue = `tg_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000${domainPart}`;
        const response = new Response(
          JSON.stringify({
            success: true,
            sessionToken,
            user: {
              id: userId,
              telegramUserId,
              displayName,
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": cookieValue,
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
        this.activeSessions.delete(qrId);
        return response;
      }

      return new Response(JSON.stringify({ success: false }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    } catch (checkErr: any) {
      console.error("[handleCheckHttp Error]:", checkErr);
      return new Response(JSON.stringify({ error: checkErr.message || "Failed checking login" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}
