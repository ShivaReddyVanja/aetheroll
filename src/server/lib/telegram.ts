import { TelegramClient, Api, sessions } from "telegram";

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  testMode?: boolean;
  dcIp?: string;
  dcPort?: number;
}

export function getDefaultTelegramConfig(): TelegramConfig {
  return {
    apiId: parseInt(process.env.TELEGRAM_API_ID || "2496", 10),
    apiHash: process.env.TELEGRAM_API_HASH || "8da85b0d5b165218c3a5585098d5786d",
    testMode: process.env.TELEGRAM_TEST_MODE === "true",
    dcIp: process.env.TELEGRAM_DC_IP || undefined,
    dcPort: process.env.TELEGRAM_DC_PORT ? parseInt(process.env.TELEGRAM_DC_PORT, 10) : undefined,
  };
}

// Global client connection pool to maintain persistent MTProto connections
const clientPool = new Map<string, { client: TelegramClient; lastUsed: number }>();

// Periodically clean up clients idle for more than 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of clientPool.entries()) {
    if (now - item.lastUsed > 10 * 60 * 1000) {
      try {
        item.client.disconnect();
      } catch {}
      clientPool.delete(key);
    }
  }
}, 60000);

/**
 * Creates a TelegramClient instance with an optional saved StringSession
 */
export function createTelegramClient(sessionString: string = "", config?: TelegramConfig): TelegramClient {
  const cfg = config || getDefaultTelegramConfig();
  const session = new sessions.StringSession(sessionString || "");

  const client = new TelegramClient(session, cfg.apiId, cfg.apiHash, {
    connectionRetries: 5,
    useWSS: false, // In Node.js / worker TCP
    testServers: cfg.testMode,
    deviceModel: "Telegram Gallery Web",
    systemVersion: "Web",
    appVersion: "1.0.0",
    timeout: 30,
    autoReconnect: true,
  });

  return client;
}

/**
 * Reuses an active persistent TelegramClient or connects a new one
 */
export async function getConnectedClient(sessionString: string, config?: TelegramConfig): Promise<TelegramClient> {
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
export async function startQrLogin(config?: TelegramConfig): Promise<{
  token: string;
  expires: number;
  client: TelegramClient;
  tokenBuffer: Buffer;
}> {
  const client = createTelegramClient("", config);
  await client.connect();

  const qrLogin = await client.invoke(
    new Api.auth.ExportLoginToken({
      apiId: (config || getDefaultTelegramConfig()).apiId,
      apiHash: (config || getDefaultTelegramConfig()).apiHash,
      exceptIds: [],
    })
  );

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

  throw new Error("Unexpected response from Telegram auth.ExportLoginToken");
}

/**
 * Checks if QR code has been scanned and accepted by the user on their phone
 */
export async function checkQrLoginStatus(
  client: TelegramClient,
  tokenBuffer: Buffer
): Promise<{ success: boolean; sessionString?: string; user?: any }> {
  try {
    const config = getDefaultTelegramConfig();
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: config.apiId,
        apiHash: config.apiHash,
        exceptIds: [],
      })
    );

    // 1. Successful login on the current DC
    if (result instanceof Api.auth.LoginTokenSuccess) {
      const auth = result.authorization as any;
      const authUser = auth?.user || auth;
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
        const authUser = auth?.user || auth;
        const sessionString = (client.session as any).save();
        console.log(`[MTProto] Logged in successfully on migrated DC ${result.dcId} as ${authUser.firstName || authUser.id}`);
        return {
          success: true,
          sessionString,
          user: authUser,
        };
      }
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
