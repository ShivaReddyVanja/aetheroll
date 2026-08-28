import { TelegramClient, Api, sessions } from "telegram";
import { ConnectionTCPObfuscated } from "telegram/network/connection/TCPObfuscated.js";
import { PromisedWebSockets } from "telegram/extensions/PromisedWebSockets.js";

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  testMode?: boolean;
  dcIp?: string;
  dcPort?: number;
}

export function getDefaultTelegramConfig(envObj?: any): TelegramConfig {
  const rawApiId = envObj?.TELEGRAM_API_ID ?? process.env?.TELEGRAM_API_ID;
  const apiHash = envObj?.TELEGRAM_API_HASH ?? process.env?.TELEGRAM_API_HASH;
  const testMode = (envObj?.TELEGRAM_TEST_MODE ?? process.env?.TELEGRAM_TEST_MODE) === "true";
  const dcIp = envObj?.TELEGRAM_DC_IP ?? process.env?.TELEGRAM_DC_IP ?? undefined;
  const dcPort = envObj?.TELEGRAM_DC_PORT ?? process.env?.TELEGRAM_DC_PORT;

  if (!rawApiId || String(rawApiId).trim() === "" || isNaN(parseInt(String(rawApiId), 10))) {
    throw new Error("Missing or invalid required environment variable: TELEGRAM_API_ID. Please configure it in wrangler.toml or set it via secret.");
  }

  if (!apiHash || String(apiHash).trim() === "") {
    throw new Error("Missing required environment variable: TELEGRAM_API_HASH. Please configure it in wrangler.toml or set it via secret.");
  }

  return {
    apiId: parseInt(String(rawApiId), 10),
    apiHash: String(apiHash).trim(),
    testMode,
    dcIp,
    dcPort: dcPort ? parseInt(String(dcPort), 10) : undefined,
  };
}

// Global client connection pool to maintain persistent MTProto connections
const clientPool = new Map<string, { client: TelegramClient; lastUsed: number }>();

function cleanupClientPool() {
  const now = Date.now();
  for (const [key, item] of clientPool.entries()) {
    if (now - item.lastUsed > 10 * 60 * 1000) {
      try {
        item.client.disconnect();
      } catch {}
      clientPool.delete(key);
    }
  }
}

const DC_DOMAINS: Record<number, string> = {
  1: "pluto.web.telegram.org",
  2: "venus.web.telegram.org",
  3: "aurora.web.telegram.org",
  4: "vesta.web.telegram.org",
  5: "flora.web.telegram.org",
};

export function createTelegramClient(
  sessionOrConfig?: string | TelegramConfig | any,
  maybeConfig?: TelegramConfig | any
): TelegramClient {
  let sessionString = "";
  let config: any;

  if (typeof sessionOrConfig === "object" && sessionOrConfig !== null) {
    config = sessionOrConfig;
    sessionString = "";
  } else {
    sessionString = typeof sessionOrConfig === "string" ? sessionOrConfig : "";
    config = maybeConfig;
  }

  const cfg = (config && typeof config === "object" && "apiId" in config)
    ? config
    : getDefaultTelegramConfig(config);

  const session = new sessions.StringSession(sessionString || "");

  const client = new TelegramClient(session, cfg.apiId, cfg.apiHash, {
    useWSS: true,
    connection: ConnectionTCPObfuscated,
    networkSocket: PromisedWebSockets,
    connectionRetries: 3,
    retryDelay: 1000,
    testServers: cfg.testMode,
    deviceModel: "Aetheroll Web",
    systemVersion: "Web",
    appVersion: "1.0.0",
    timeout: 30,
    autoReconnect: true,
  });

  // Override getDC to return official SSL domain names for WebSocket TLS validation
  client.getDC = async (dcId: number, downloadDC?: boolean) => {
    const domain = DC_DOMAINS[dcId] || "venus.web.telegram.org";
    return {
      id: dcId,
      ipAddress: downloadDC ? domain.replace(".web.telegram.org", "-1.web.telegram.org") : domain,
      port: 443,
    };
  };

  // Ensure serverAddress uses the valid SSL domain name (never raw IP which fails Cloudflare WSS TLS certificate check)
  const targetDcId = session.dcId || (cfg.testMode ? 2 : 2);
  const targetDomain = DC_DOMAINS[targetDcId] || "venus.web.telegram.org";
  session.setDC(targetDcId, targetDomain, 443);

  return client;
}

/**
 * Reuses an active persistent TelegramClient or connects a new one
 */
export async function getConnectedClient(sessionString: string, config?: TelegramConfig): Promise<TelegramClient> {
  cleanupClientPool();
  const existing = clientPool.get(sessionString);
  if (existing && existing.client.connected) {
    existing.lastUsed = Date.now();
    return existing.client;
  }

  const client = createTelegramClient(sessionString, config);
  await client.connect();
  clientPool.set(sessionString, { client, lastUsed: Date.now() });
  return client;
}

/**
 * Initiates QR Code Login Challenge with Telegram
 */
export async function startQrLogin(config?: TelegramConfig | any): Promise<{
  token: string;
  expires: number;
  client: TelegramClient;
  tokenBuffer: Buffer;
}> {
  const cfg = (config && typeof config === "object" && "apiId" in config) ? config : getDefaultTelegramConfig(config);
  const client = createTelegramClient("", cfg);
  await client.connect();

  let qrLogin = await client.invoke(
    new Api.auth.ExportLoginToken({
      apiId: cfg.apiId,
      apiHash: cfg.apiHash,
      exceptIds: [],
    })
  );

  if (qrLogin instanceof Api.auth.LoginTokenMigrateTo) {
    console.log(`[MTProto] Initial ExportLoginToken redirected to DC ${qrLogin.dcId}...`);
    await (client as any)._switchDC(qrLogin.dcId);
    qrLogin = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: cfg.apiId,
        apiHash: cfg.apiHash,
        exceptIds: [],
      })
    );
  }

  if (qrLogin instanceof Api.auth.LoginToken) {
    // Generate tg://login?token=... URL for QR code
    const tokenBase64 = Buffer.from(qrLogin.token).toString("base64url");
    return {
      token: `tg://login?token=${tokenBase64}`,
      expires: qrLogin.expires,
      client,
      tokenBuffer: Buffer.from(qrLogin.token),
    };
  }

  throw new Error(`Unexpected response from Telegram auth.ExportLoginToken: ${(qrLogin as any)?.className || typeof qrLogin}`);
}

/**
 * Checks if QR code has been scanned and accepted by the user on their phone
 */
export async function checkQrLoginStatus(
  client: TelegramClient,
  tokenBuffer: Buffer,
  config?: TelegramConfig | any
): Promise<{ success: boolean; sessionString?: string; user?: any }> {
  try {
    const cfg = (config && typeof config === "object" && "apiId" in config) ? config : getDefaultTelegramConfig(config);
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: cfg.apiId,
        apiHash: cfg.apiHash,
        exceptIds: [],
      })
    );

    // 1. Successful login on the current DC
    if (result instanceof Api.auth.LoginTokenSuccess) {
      const auth = result.authorization as any;
      let authUser = auth?.user || auth;
      if (!authUser || !authUser.id) {
        try { authUser = await client.getMe(); } catch {}
      }
      const sessionString = (client.session as any).save();
      return {
        success: true,
        sessionString,
        user: authUser,
      };
    }

    // 2. User account is hosted on a different Telegram DC (Requires DC Migration)
    if (result instanceof Api.auth.LoginTokenMigrateTo) {
      console.log(`[MTProto] Migrating QR session to DC ${result.dcId}...`);
      await (client as any)._switchDC(result.dcId);

      const migratedResult = await client.invoke(
        new Api.auth.ImportLoginToken({
          token: result.token,
        })
      );

      if (migratedResult instanceof Api.auth.LoginTokenSuccess) {
        const auth = migratedResult.authorization as any;
        let authUser = auth?.user || auth;
        if (!authUser || !authUser.id) {
          try { authUser = await client.getMe(); } catch {}
        }
        const sessionString = (client.session as any).save();
        console.log(`[MTProto] Logged in successfully on migrated DC ${result.dcId} as ${authUser?.firstName || authUser?.id}`);
        return {
          success: true,
          sessionString,
          user: authUser,
        };
      }
    }

    // 3. Fallback: check if client is authorized
    if (await client.isUserAuthorized()) {
      const me = await client.getMe();
      const sessionString = (client.session as any).save();
      return {
        success: true,
        sessionString,
        user: me,
      };
    }
  } catch (err: any) {
    if (err?.errorMessage === "AUTH_TOKEN_EXPIRED") {
      throw new Error("QR token expired. Please refresh.");
    }
    console.error("[MTProto] Check QR status error:", err);
  }

  return { success: false };
}

/**
 * Fetches all channels, groups, and Saved Messages the user belongs to
 */
export async function getUserChannels(client: TelegramClient): Promise<Array<{
  id: string;
  title: string;
  username?: string;
  isChannel: boolean;
  isGroup: boolean;
  participantsCount?: number;
}>> {
  if (!client.connected) {
    await client.connect();
  }

  const dialogs = await client.getDialogs({ limit: 100 });
  const channels = [];

  // Always include "Saved Messages" (Your Private Cloud Vault)
  channels.push({
    id: "me",
    title: "Saved Messages (Private Cloud)",
    username: undefined,
    isChannel: true,
    isGroup: false,
    participantsCount: 1,
  });

  for (const dialog of dialogs) {
    const entity = dialog.entity as any;
    if (dialog.isChannel || dialog.isGroup) {
      const channelId = dialog.id?.toString() || "";
      if (channelId && channelId !== "me") {
        channels.push({
          id: channelId,
          title: dialog.title || "Untitled Channel",
          username: entity?.username,
          isChannel: dialog.isChannel,
          isGroup: dialog.isGroup,
          participantsCount: entity?.participantsCount,
        });
      }
    }
  }

  return channels;
}

/**
 * Initiates phone number verification code sending
 */
export async function sendPhoneCode(
  phoneNumber: string,
  config?: TelegramConfig | any
): Promise<{
  client: TelegramClient;
  phoneCodeHash: string;
  isCodeViaApp?: boolean;
}> {
  const cfg = config && typeof config === "object" && "apiId" in config ? config : getDefaultTelegramConfig(config);
  const client = createTelegramClient("", cfg);
  await client.connect();

  const res = await client.sendCode(
    {
      apiId: cfg.apiId,
      apiHash: cfg.apiHash,
    },
    phoneNumber
  );

  return {
    client,
    phoneCodeHash: res.phoneCodeHash,
    isCodeViaApp: res.isCodeViaApp,
  };
}

/**
 * Completes phone number sign-in with code (and optional 2FA password)
 */
export async function verifyPhoneCode(
  client: TelegramClient,
  phoneNumber: string,
  phoneCodeHash: string,
  phoneCode: string,
  password?: string,
  config?: TelegramConfig | any
): Promise<{
  success: boolean;
  requires2FA?: boolean;
  sessionString?: string;
  user?: any;
  error?: string;
}> {
  try {
    const cfg = config && typeof config === "object" && "apiId" in config ? config : getDefaultTelegramConfig(config);

    if (!client.connected) {
      console.log("[MTProto] Reconnecting disconnected client for phone verification...");
      await client.connect();
    }

    if (password) {
      // 2FA password verification
      try {
        const user = await client.signInWithPassword(
          { apiId: cfg.apiId, apiHash: cfg.apiHash },
          {
            password: async () => password,
            onError: (err) => {
              console.error("[MTProto] 2FA error:", err);
            },
          }
        );

        let authUser = (user as any)?.user || user;
        if (!authUser || !authUser.id) {
          try {
            authUser = await client.getMe();
          } catch {}
        }

        const sessionString = (client.session as any).save();
        return {
          success: true,
          sessionString,
          user: authUser,
        };
      } catch (err: any) {
        return {
          success: false,
          requires2FA: true,
          error: "Incorrect 2FA password. Please try again.",
        };
      }
    }

    // Code verification via RPC Api.auth.SignIn
    try {
      const signInResult = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode,
        })
      );

      const auth = signInResult as any;
      let authUser = auth?.user || auth;
      if (!authUser || !authUser.id) {
        try {
          authUser = await client.getMe();
        } catch {}
      }

      const sessionString = (client.session as any).save();
      return {
        success: true,
        sessionString,
        user: authUser,
      };
    } catch (err: any) {
      if (err?.errorMessage === "SESSION_PASSWORD_NEEDED" || err?.message?.includes("SESSION_PASSWORD_NEEDED")) {
        return {
          success: false,
          requires2FA: true,
        };
      }
      if (err?.errorMessage === "PHONE_CODE_INVALID") {
        return { success: false, error: "Invalid verification code. Please check the code sent to your Telegram app." };
      }
      if (err?.errorMessage === "PHONE_CODE_EXPIRED") {
        return { success: false, error: "Verification code expired. Please request a new code." };
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[MTProto] Phone auth error:", err);
    return {
      success: false,
      error: err.message || "Failed to verify phone code",
    };
  }
}


