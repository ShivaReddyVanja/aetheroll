import { extractSessionToken } from "../../lib/auth.ts";
import { getDb } from "../../lib/db.ts";
import { decryptSession } from "../../lib/crypto.ts";
import { getDefaultTelegramConfig, getConnectedClient } from "../../lib/telegram.ts";
import type { UserClientEntry } from "../common/types.ts";

export class ClientSessionManager {
  userClients: Map<string, UserClientEntry>;

  constructor() {
    this.userClients = new Map();
  }

  /**
   * Unified session resolution and MTProto client warmup with Dual-Key decryption & idle tracking
   */
  async getOrConnectUserClient(
    request: Request,
    envObj: any
  ): Promise<{ client: any; userId?: string; sessionId?: string; error?: string }> {
    this.sweepIdleClients();

    const parsed = extractSessionToken(request);
    if (!parsed) {
      return { client: null, error: "Unauthorized: Missing session token" };
    }

    const cached = this.userClients.get(parsed.fullToken) || this.userClients.get(parsed.sessionId);
    if (cached && cached.client && cached.client.connected) {
      cached.lastUsed = Date.now();
      return { client: cached.client, userId: (cached.client as any).__userId, sessionId: parsed.sessionId };
    }

    const db = getDb(envObj?.DB);
    const session = await db.get(
      `SELECT u.id as user_id, u.telegram_user_id, u.display_name, u.session_string, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [parsed.sessionId]
    );

    if (!session) {
      return { client: null, error: "Unauthorized: Session not found or expired" };
    }

    try {
      const decrypted = await decryptSession(
        session.session_string,
        envObj?.SESSION_ENCRYPTION_KEY,
        parsed.clientSecret
      );
      const config = getDefaultTelegramConfig(envObj);
      const client = await getConnectedClient(decrypted, config);
      (client as any).__userId = session.user_id;

      this.userClients.set(parsed.fullToken, { client, lastUsed: Date.now() });
      this.userClients.set(parsed.sessionId, { client, lastUsed: Date.now() });
      return { client, userId: session.user_id, sessionId: parsed.sessionId };
    } catch (decryptErr: any) {
      return { client: null, error: "Unauthorized: Session decryption failed" };
    }
  }

  /**
   * 15-minute sliding inactivity sweeper that disconnects idle sessions from RAM
   */
  sweepIdleClients() {
    const now = Date.now();
    const IDLE_LIMIT = 15 * 60 * 1000;
    for (const [key, entry] of this.userClients.entries()) {
      if (now - entry.lastUsed > IDLE_LIMIT) {
        try {
          if (entry.client && typeof entry.client.disconnect === "function") {
            entry.client.disconnect();
          }
        } catch {}
        this.userClients.delete(key);
      }
    }
  }
}
