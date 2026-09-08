import { Hono } from "hono";
import { Api, utils } from "telegram";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { getR2Storage } from "../../lib/r2";
import { getConnectedClient } from "../../lib/telegram";
import { isTelemetryEnabled } from "../logs";

export const thumbnailMediaRoute = new Hono();

/**
 * POST /:id/thumbnail
 * Ingests a client-captured video frame or custom thumbnail, saves it to R2 and Edge Cache, and updates D1
 */
thumbnailMediaRoute.post("/:id/thumbnail", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const mediaId = c.req.param("id");
    const db = getDb((c.env as any)?.DB);
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);

    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.json({ error: "Media item not found" }, 404);

    let imageBuffer: Buffer | null = null;
    const contentType = c.req.header("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      if (body.imageBase64) {
        imageBuffer = Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      }
    } else if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("thumbnail") as File;
      if (file) {
        const ab = await file.arrayBuffer();
        imageBuffer = Buffer.from(ab);
      }
    } else {
      const ab = await c.req.arrayBuffer();
      if (ab.byteLength > 0) {
        imageBuffer = Buffer.from(ab);
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return c.json({ error: "No image payload provided" }, 400);
    }

    const key = `thumbnails/${item.channel_id}/${item.id}.jpg`;
    await r2.put(key, imageBuffer, "image/jpeg");
    await db.run("UPDATE media_items SET thumbnail_r2_key = ? WHERE id = ?", [key, item.id]);

    // Cache into Cloudflare Edge Cache
    const workerOrigin = new URL(c.req.url).origin;
    const cacheKeyUrl = `${workerOrigin}/api/media/cache/${encodeURIComponent(mediaId)}/thumbnail`;
    const cacheKey = new Request(cacheKeyUrl, { method: "GET" });
    const cache = typeof caches !== "undefined" ? (caches as any)?.default : null;
    if (cache) {
      const edgeHeaders = new Headers();
      edgeHeaders.set("Content-Type", "image/jpeg");
      edgeHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
      edgeHeaders.set("Access-Control-Allow-Origin", "*");
      const edgeResponse = new Response(imageBuffer as any, {
        status: 200,
        headers: edgeHeaders,
      });
      const putPromise = cache.put(cacheKey, edgeResponse).catch(() => {});
      if ((c.executionCtx as any)?.waitUntil) {
        c.executionCtx.waitUntil(putPromise);
      }
    }

    return c.json({ success: true, thumbnail_r2_key: key });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed saving thumbnail" }, 500);
  }
});

/**
 * GET /:id/thumbnail
 * Serves cached thumbnail from Cloudflare Edge Cache, R2, or decodes stripped bytes instantly from Telegram
 */
thumbnailMediaRoute.get("/:id/thumbnail", async (c) => {
  try {
    const mediaId = c.req.param("id");
    if (!mediaId) return c.text("Not Found", 404);

    // 1. Check Cloudflare Edge Cache
    const workerOrigin = new URL(c.req.url).origin;
    const cacheKeyUrl = `${workerOrigin}/api/media/cache/${encodeURIComponent(mediaId)}/thumbnail`;
    const cacheKey = new Request(cacheKeyUrl, { method: "GET" });
    const cache = typeof caches !== "undefined" ? (caches as any)?.default : null;

    if (cache) {
      try {
        const cachedRes = await cache.match(cacheKey);
        if (cachedRes) {
          const hitHeaders = new Headers(cachedRes.headers);
          hitHeaders.set("x-edge-cache", "HIT");

          // Log Edge HIT to DO telemetry in background only when enabled
          const authDo = (c.env as any)?.AUTH_DO;
          if (authDo && typeof authDo.idFromName === "function" && isTelemetryEnabled(c.env)) {
            const doId = authDo.idFromName("global_telemetry");
            const stub = authDo.get(doId);
            const logReq = new Request(`${workerOrigin}/api/logs/log`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: "EDGE_CACHE",
                level: "success",
                message: `🟢 [Thumbnail Edge HIT ⚡ 1ms] ${mediaId.slice(0, 8)}...`,
                meta: { mediaId, hit: true },
              }),
            });
            if ((c.executionCtx as any)?.waitUntil) {
              c.executionCtx.waitUntil(stub.fetch(logReq).catch(() => {}));
            }
          }

          return new Response(cachedRes.body, {
            status: cachedRes.status,
            headers: hitHeaders,
          });
        }
      } catch (cacheErr) {
        console.warn("[EdgeCache] Thumbnail match error:", cacheErr);
      }
    }

    const db = getDb((c.env as any)?.DB);
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);

    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.text("Not Found", 404);

    let response: Response | null = null;

    // 2. Check R2 Cache
    if (item.thumbnail_r2_key) {
      const cached = await r2.get(item.thumbnail_r2_key);
      if (cached) {
        response = new Response(cached as any, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // 3. Fallback: Fetch from Telegram on cache miss
    if (!response) {
      const auth = await resolveUserAuth(c);
      if (!auth.authenticated || !auth.sessionString) return c.text("Unauthorized", 401);

      const authDo = (c.env as any)?.AUTH_DO;
      if (authDo && typeof authDo.idFromName === "function") {
        try {
          const token = auth.sessionId || auth.userId || "default";
          const doId = authDo.idFromName(token);
          const stub = authDo.get(doId);

          const headers = new Headers();
          if (auth.sessionId) headers.set("x-tg-session", auth.sessionId);
          if (c.req.header("cookie")) headers.set("cookie", c.req.header("cookie")!);
          if (c.req.header("authorization")) headers.set("authorization", c.req.header("authorization")!);
          const env = c.env as any;
          if (env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(env.TELEGRAM_API_ID));
          if (env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(env.TELEGRAM_API_HASH));
          if (env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(env.TELEGRAM_TEST_MODE));
          if (env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(env.SESSION_ENCRYPTION_KEY));
          headers.set("x-target-channel-id", item.telegram_channel_id);
          headers.set("x-target-msg-id", String(item.telegram_message_id));

          const thumbReq = new Request("https://internal.do/api/media/thumbnail", {
            method: "GET",
            headers,
          });

          const doRes = await stub.fetch(thumbReq);
          if (doRes.ok) {
            const thumbBuffer = Buffer.from(await doRes.arrayBuffer());
            if (thumbBuffer.length > 0) {
              const key = `thumbnails/${item.channel_id}/${item.id}.jpg`;
              try {
                await r2.put(key, thumbBuffer, "image/jpeg");
                await db.run("UPDATE media_items SET thumbnail_r2_key = ? WHERE id = ?", [key, item.id]);
              } catch (r2Err) {
                console.warn("[Thumbnail] R2 cache write non-fatal error:", r2Err);
              }

              response = new Response(thumbBuffer as any, {
                headers: {
                  "Content-Type": "image/jpeg",
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "Access-Control-Allow-Origin": "*",
                },
              });
            }
          }
        } catch (doErr) {
          console.warn("[Thumbnail] DO fallback error:", doErr);
        }
      } else {
        // Fallback for local Node / testing environment without Durable Object
        try {
          const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);

          let targetPeer: any = item.telegram_channel_id;
          if (item.telegram_channel_id === "me" || item.telegram_channel_id.startsWith("me_")) {
            targetPeer = "me";
          } else {
            try {
              targetPeer = await client.getInputEntity(item.telegram_channel_id);
            } catch {
              try {
                targetPeer = await client.getEntity(item.telegram_channel_id);
              } catch {}
            }
          }

          const msgId = Number(item.telegram_message_id);
          const messages = await client.getMessages(targetPeer, { ids: [msgId] });
          const msg = messages[0];

          if (msg && msg.media) {
            let thumbBuffer: Buffer | null = null;
            const photoSizes = (msg.media as any)?.photo?.sizes || [];
            const docThumbs = (msg.media as any)?.document?.thumbs || [];

            // 3a. Try multi-size thumbs (thumb 1, then thumb 0) for documents/videos
            if (docThumbs.length > 0) {
              for (let idx = Math.min(docThumbs.length - 1, 1); idx >= 0; idx--) {
                try {
                  const downloaded = await client.downloadMedia(msg.media, { thumb: idx });
                  if (downloaded && Buffer.isBuffer(downloaded) && downloaded.length > 0) {
                    thumbBuffer = downloaded;
                    break;
                  }
                } catch {}
              }
            }

            // 3b. For photos: download real photo/thumb directly
            if (!thumbBuffer && (msg.photo || item.file_type === "photo")) {
              try {
                const downloaded = await client.downloadMedia(msg.media, { thumb: 1 }).catch(() => null)
                  || await client.downloadMedia(msg.media).catch(() => null);
                if (downloaded && Buffer.isBuffer(downloaded) && downloaded.length > 0) {
                  thumbBuffer = downloaded;
                }
              } catch {}
            }

            // 3c. Last-resort fallback ONLY: 30px stripped preview if network download fails
            if (!thumbBuffer) {
              const stripped = [...photoSizes, ...docThumbs].find(
                (s: any) => s instanceof Api.PhotoStrippedSize || s.className === "PhotoStrippedSize" || s.bytes
              );

              if (stripped && stripped.bytes) {
                try {
                  thumbBuffer = Buffer.from(utils.strippedPhotoToJpg(stripped.bytes));
                } catch (stripErr) {
                  console.warn("[Thumbnail] Stripped JPEG conversion fallback:", stripErr);
                }
              }
            }

            // 3d. If real thumbBuffer found, save to R2 and return
            if (thumbBuffer && Buffer.isBuffer(thumbBuffer) && thumbBuffer.length > 0) {
              const key = `thumbnails/${item.channel_id}/${item.id}.jpg`;
              try {
                await r2.put(key, thumbBuffer, "image/jpeg");
                await db.run("UPDATE media_items SET thumbnail_r2_key = ? WHERE id = ?", [key, item.id]);
              } catch (r2Err) {
                console.warn("[Thumbnail] R2 cache write non-fatal error:", r2Err);
              }

              response = new Response(thumbBuffer as any, {
                headers: {
                  "Content-Type": "image/jpeg",
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "Access-Control-Allow-Origin": "*",
                },
              });
            }
          }
        } catch (clientErr) {
          console.warn("[Thumbnail] Telegram client fallback error:", clientErr);
        }
      }
    }

    // 4. Zero-Fail Dynamic SVG Fallback
    if (!response) {
      const isVid = item.file_type === "video";
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width || 400}" height="${item.height || 300}" viewBox="0 0 400 300" fill="none">
        <rect width="400" height="300" fill="${isVid ? "#0f172a" : "#1e293b"}"/>
        <circle cx="200" cy="130" r="32" fill="${isVid ? "#1e293b" : "#334155"}"/>
        <circle cx="200" cy="130" r="30" fill="${isVid ? "#2563eb" : "#059669"}" fill-opacity="0.2"/>
        ${isVid 
          ? '<path d="M194 118L212 130L194 142V118Z" fill="#38bdf8"/>' 
          : '<path d="M188 124C188 121.791 189.791 120 192 120H208C210.209 120 212 121.791 212 124V136C212 138.209 210.209 140 208 140H192C189.791 140 188 138.209 188 136V124Z" stroke="#34d399" stroke-width="2"/>'}
        <text x="200" y="190" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="500" fill="#94a3b8" text-anchor="middle">${isVid ? "Video" : "Photo"}</text>
      </svg>`;

      response = new Response(svgContent, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 5. Save to Cloudflare Edge Cache in Background
    if (cache && response.status === 200) {
      try {
        const resToCache = response.clone();
        const edgeHeaders = new Headers(resToCache.headers);
        edgeHeaders.set("Cache-Control", "public, max-age=31536000, immutable");

        const edgeResponse = new Response(resToCache.body, {
          status: 200,
          headers: edgeHeaders,
        });

        const putPromise = cache.put(cacheKey, edgeResponse).catch(() => {});
        if ((c.executionCtx as any)?.waitUntil) {
          c.executionCtx.waitUntil(putPromise);
        }
      } catch (putErr) {
        console.warn("[EdgeCache] Thumbnail save error:", putErr);
      }
    }

    const outHeaders = new Headers(response.headers);
    outHeaders.set("x-edge-cache", "MISS");
    return new Response(response.body, {
      status: response.status,
      headers: outHeaders,
    });
  } catch (error: any) {
    return c.text(error.message || "Thumbnail error", 500);
  }
});
