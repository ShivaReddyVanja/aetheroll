import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import crypto from "crypto";
import { getDb } from "../../lib/db";
import { encryptSession } from "../../lib/crypto";
import { startQrLogin, checkQrLoginStatus, getDefaultTelegramConfig } from "../../lib/telegram";

export const qrStreamRoute = new Hono();

/**
 * GET /qr-stream
 * Server-Sent Events (SSE) stream for Cloudflare Workers & Serverless.
 * Holds open the MTProto client on the exact same isolate until scanned or expired.
 */
qrStreamRoute.get("/qr-stream", async (c) => {
  return streamSSE(c, async (stream) => {
    let client: any = null;

    try {
      const config = getDefaultTelegramConfig(c.env);
      const challenge = await startQrLogin(config);
      client = challenge.client;

      // Generate pure SVG QR code (zero canvas dependencies)
      const qrSvg = await QRCode.toString(challenge.token, {
        type: "svg",
        width: 280,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      const qrImageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

      // Send initial QR Code to browser
      await stream.writeSSE({
        event: "qr",
        data: JSON.stringify({
          qrUrl: challenge.token,
          qrImage: qrImageDataUrl,
          expires: challenge.expires,
        }),
      });

      stream.onAbort(() => {
        try {
          if (client) client.disconnect();
        } catch {}
      });

      const startTime = Date.now();
      const maxDuration = 60 * 1000; // 60 seconds validity window

      while (!stream.aborted && Date.now() - startTime < maxDuration) {
        await stream.sleep(2000);
        if (stream.aborted) break;

        try {
          const check = await checkQrLoginStatus(client, challenge.tokenBuffer, config);

          if (check.success && check.sessionString && check.user) {
            const db = getDb((c.env as any)?.DB);
            const telegramUserId = check.user.id?.toString() || check.user.id;
            const displayName =
              [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") ||
              check.user.username ||
              "Telegram User";
            const encryptedSession = await encryptSession(
              check.sessionString,
              (c.env as any)?.SESSION_ENCRYPTION_KEY
            );

            let user = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
            const userId = user?.id || crypto.randomUUID();

            if (!user) {
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

            const sessionToken = crypto.randomBytes(32).toString("hex");
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            await db.run(
              "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
              [sessionToken, userId, expiresAt]
            );

            await stream.writeSSE({
              event: "authenticated",
              data: JSON.stringify({
                success: true,
                sessionToken,
                user: {
                  id: userId,
                  telegramUserId,
                  displayName,
                },
              }),
            });

            try {
              if (client) client.disconnect();
            } catch {}
            return;
          }
        } catch (err: any) {
          if (err?.message?.includes("expired")) {
            await stream.writeSSE({
              event: "expired",
              data: JSON.stringify({ error: "QR Token expired" }),
            });
            break;
          }
        }
      }

      // Expired without scan
      await stream.writeSSE({
        event: "expired",
        data: JSON.stringify({ error: "QR Token expired" }),
      });
    } catch (err: any) {
      console.error("[QR Stream Error]:", err);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: err.message || "Failed to start QR stream" }),
      });
    } finally {
      try {
        if (client) client.disconnect();
      } catch {}
    }
  });
});
