import { extractAllSessionTokens } from "../../lib/auth";
import { getDb } from "../../lib/db";
import { decryptSession } from "../../lib/crypto";
import { getDefaultTelegramConfig, getConnectedClient } from "../../lib/telegram";
import type { UserClientEntry } from "../common/types";

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

    const candidates = extractAllSessionTokens(request);
    if (candidates.length === 0) {
      return { client: null, error: "Unauthorized: Missing session token" };
    }

    // Check RAM cache for any candidate
    for (const parsed of candidates) {
      const cached = this.userClients.get(parsed.fullToken) || this.userClients.get(parsed.sessionId);
      if (cached && cached.client && cached.client.connected) {
        cached.lastUsed = Date.now();
        return { client: cached.client, userId: (cached.client as any).__userId, sessionId: parsed.sessionId };
      }
    }

    const db = getDb(envObj?.DB);
    let lastError = "Unauthorized: Session not found or expired";

    for (const parsed of candidates) {
      try {
        const session = await db.get(
          `SELECT u.id as user_id, u.telegram_user_id, u.display_name, u.session_string, s.expires_at
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
          [parsed.sessionId]
        );

        if (!session) continue;

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
        lastError = "Unauthorized: Session decryption failed";
      }
    }

    return { client: null, error: lastError };
  }

  /**
   * Resolves userId from warm RAM session cache without hitting D1 database
   */
  resolveUserIdFromRequest(request: Request): string | null {
    const candidates = extractAllSessionTokens(request);
    for (const parsed of candidates) {
      const cached = this.userClients.get(parsed.fullToken) || this.userClients.get(parsed.sessionId);
      if (cached && cached.client && (cached.client as any).__userId) {
        return (cached.client as any).__userId;
      }
    }
    return null;
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
