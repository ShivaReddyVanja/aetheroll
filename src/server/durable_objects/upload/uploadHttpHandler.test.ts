import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UploadHttpHandler } from "./uploadHttpHandler.ts";
import { ClientSessionManager } from "../auth/clientSessionManager.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";

function createMockD1(result: any = null) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: async () => result,
        all: async () => ({ results: result ? [result] : [] }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    exec: async () => {},
  };
}

describe("⚡ DO Upload HTTP Handler Suite", () => {
  it("1. handleUploadInit should reject requests with missing parameters", async () => {
    const handler = new UploadHttpHandler();
    const clientManager = new ClientSessionManager();
    const { sessionToken } = generateCompositeSessionToken();

    clientManager.userClients.set(sessionToken, {
      client: { connected: true, __userId: "u1" },
      lastUsed: Date.now(),
    });

    const req = new Request("https://example.com/upload/init", {
      method: "POST",
      headers: { "x-tg-session": sessionToken, "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "c1" }), // missing file_name, file_size, total_chunks
    });

    const res = await handler.handleUploadInit(req, {}, clientManager);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /required/i);
  });

  it("2. handleUploadInit should reject files exceeding 2,000MB limit", async () => {
    const handler = new UploadHttpHandler();
    const clientManager = new ClientSessionManager();
    const { sessionToken } = generateCompositeSessionToken();

    clientManager.userClients.set(sessionToken, {
      client: { connected: true, __userId: "u1" },
      lastUsed: Date.now(),
    });

    const req = new Request("https://example.com/upload/init", {
      method: "POST",
      headers: { "x-tg-session": sessionToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: "c1",
        file_name: "huge.mp4",
        file_size: 2100 * 1024 * 1024, // 2.1 GB
        total_chunks: 4200,
      }),
    });

    const res = await handler.handleUploadInit(req, {}, clientManager);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /exceeds Telegram's 2,000 MB/i);
  });

  it("3. handleUploadInit should succeed and initialize upload session", async () => {
    const handler = new UploadHttpHandler();
    const clientManager = new ClientSessionManager();
    const { sessionToken } = generateCompositeSessionToken();

    clientManager.userClients.set(sessionToken, {
      client: { connected: true, __userId: "u1" },
      lastUsed: Date.now(),
    });

    const mockDb = createMockD1({ id: "c1", telegram_channel_id: "me" });

    const req = new Request("https://example.com/upload/init", {
      method: "POST",
      headers: { "x-tg-session": sessionToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: "c1",
        file_name: "photo.jpg",
        file_size: 1024 * 1024,
        total_chunks: 2,
        mime_type: "image/jpeg",
      }),
    });

    const res = await handler.handleUploadInit(req, { DB: mockDb }, clientManager);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.upload_id);
    assert.equal(body.total_chunks, 2);

    assert.ok(handler.uploadSessions.has(body.upload_id));
  });

  it("4. handleUploadComplete should reject when chunks are incomplete", async () => {
    const handler = new UploadHttpHandler();
    const clientManager = new ClientSessionManager();
    const { sessionToken } = generateCompositeSessionToken();

    clientManager.userClients.set(sessionToken, {
      client: { connected: true, __userId: "u1" },
      lastUsed: Date.now(),
    });

    const uploadId = "upload_incomplete";
    handler.uploadSessions.set(uploadId, {
      userId: "u1",
      fileId: 12345,
      totalParts: 4,
      uploadedParts: new Set([0, 1]), // only 2 of 4 parts uploaded
      fileName: "video.mp4",
      fileSize: 2 * 1024 * 1024,
      channelId: "c1",
      isBig: false,
      isVideo: true,
      mimeType: "video/mp4",
      expiresAt: Date.now() + 60000,
    });

    const mockDb = createMockD1({ id: "c1", telegram_channel_id: "me" });

    const req = new Request("https://example.com/upload/complete", {
      method: "POST",
      headers: { "x-tg-session": sessionToken, "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, channel_id: "c1" }),
    });

    const res = await handler.handleUploadComplete(req, { DB: mockDb }, clientManager);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Incomplete upload/i);
  });
});
