import { getDb } from "../../lib/db.ts";
import { createTelegramClient } from "../../lib/telegram.ts";
import { resolveUserAuth } from "../../lib/auth.ts";

/**
 * Helper to get authenticated user & their Telegram client via unified auth provider
 */
export async function getAuthUserClient(c: any) {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId || !auth.sessionString) {
    throw new Error("Unauthorized");
  }

  const db = getDb((c.env as any)?.DB);
  const client = createTelegramClient(auth.sessionString, auth.telegramConfig);
  return {
    user: {
      id: auth.userId,
      telegram_user_id: auth.telegramUserId,
      display_name: auth.displayName,
      session_string: auth.sessionString,
    },
    client,
    db,
  };
}
