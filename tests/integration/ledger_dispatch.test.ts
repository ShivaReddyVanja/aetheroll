import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelegramAuthDO } from "../../src/server/durable_objects/TelegramAuthDO.ts";
import { dispatchLedgerEvent, dispatchLedgerBatch } from "../../src/server/lib/ledger/dispatcher.ts";

describe("⚡ Warm Durable Object WAL Event Dispatch Suite", () => {

  // =========================================================================
  // 1. TelegramAuthDO Endpoint Tests (/api/ledger/emit & /api/ledger/batch)
  // =========================================================================
  describe("1. TelegramAuthDO Ledger RPC Endpoints", () => {

    it("should return 401 Unauthorized from DO /api/ledger/emit if client cannot be connected", async () => {
      const state = {};
      const env = {
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "abc",
      };
      const authDo = new TelegramAuthDO(state, env);

      // Request without auth headers
      const req = new Request("https://internal.do/api/ledger/emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelTgId: "-100123456",
          refMsgId: 42,
          op: "FAVORITE",
          data: { fav: true },
        }),
      });

      const res = await authDo.fetch(req);
      assert.equal(res.status, 401, "Should return 401 without auth");
      const json: any = await res.json();
      assert.ok(json.error, "Should contain error message");
    });

    it("should return 401 Unauthorized from DO /api/ledger/batch if client cannot be connected", async () => {
      const state = {};
      const env = {
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "abc",
      };
      const authDo = new TelegramAuthDO(state, env);

      const req = new Request("https://internal.do/api/ledger/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelTgId: "-100123456",
          ops: [{ op: "TAG_PEOPLE", refs: [42], data: { people: ["Shiva"] } }],
        }),
      });

      const res = await authDo.fetch(req);
      assert.equal(res.status, 401, "Should return 401 without auth");
    });

    it("should successfully emit single event and return eventMsgId via warm DO client", async () => {
      const state = {};
      const env = {
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "abc",
      };
      const authDo = new TelegramAuthDO(state, env);

      // Mock clientSessionManager.getOrConnectUserClient to return mock warm client
      const mockSendMessage = async (targetPeer: any, options: any) => {
        return { id: 999111 };
      };

      authDo.clientSessionManager.getOrConnectUserClient = async () => {
        return {
          client: {
            sendMessage: mockSendMessage,
            getInputEntity: async (p: any) => p,
            getEntity: async (p: any) => p,
          } as any,
          userId: "user-123",
        };
      };

      const req = new Request("https://internal.do/api/ledger/emit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tg-session": "mock-session",
        },
        body: JSON.stringify({
          channelTgId: "me",
          refMsgId: 42,
          op: "FAVORITE",
          data: { fav: true },
          customKey: "test-secret-key-32-chars-long!",
        }),
      });

      const res = await authDo.fetch(req);
      assert.equal(res.status, 200, "DO fetch should return 200 OK");
      const json: any = await res.json();
      assert.equal(json.success, true, "Emission should succeed");
      assert.equal(json.eventMsgId, 999111, "Should return emitted event message ID");
    });

    it("should successfully emit batch manifest and return eventMsgId via warm DO client", async () => {
      const state = {};
      const env = {
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "abc",
      };
      const authDo = new TelegramAuthDO(state, env);

      authDo.clientSessionManager.getOrConnectUserClient = async () => {
        return {
          client: {
            sendFile: async (targetPeer: any, options: any) => ({ id: 888222 }),
            getInputEntity: async (p: any) => p,
            getEntity: async (p: any) => p,
          } as any,
          userId: "user-123",
        };
      };

      const req = new Request("https://internal.do/api/ledger/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tg-session": "mock-session",
        },
        body: JSON.stringify({
          channelTgId: "-100123456",
          ops: [
            { op: "TAG_PEOPLE", refs: [1, 2, 3, 4, 5], data: { people: ["Alice"] } },
          ],
          customKey: "test-secret-key-32-chars-long!",
        }),
      });

      const res = await authDo.fetch(req);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.eventMsgId, 888222);
    });
  });

  // =========================================================================
  // 2. Centralized Dispatcher Tests (dispatchLedgerEvent & dispatchLedgerBatch)
  // =========================================================================
  describe("2. Centralized Ledger Dispatcher & Resilience", () => {

    it("should forward request to AUTH_DO and insert record into D1 media_event_messages", async () => {
      let fetchCalledWith: Request | null = null;

      const mockStub = {
        fetch: async (req: Request) => {
          fetchCalledWith = req;
          return new Response(JSON.stringify({ success: true, eventMsgId: 777333 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      };

      const mockAuthDo = {
        idFromName: (name: string) => "do-id-123",
        get: (id: string) => mockStub,
      };

      const insertedRows: any[] = [];
      const mockDb = {
        run: async (sql: string, params: any[]) => {
          insertedRows.push({ sql, params });
          return { changes: 1 };
        },
      };

      const mockContext: any = {
        env: {
          AUTH_DO: mockAuthDo,
          TELEGRAM_API_ID: "12345",
          TELEGRAM_API_HASH: "abc",
          SESSION_ENCRYPTION_KEY: "enckey",
        },
        req: {
          header: (h: string) => (h === "cookie" ? "session=abc" : null),
        },
      };

      const eventMsgId = await dispatchLedgerEvent({
        c: mockContext,
        auth: { sessionId: "sess-1", userId: "usr-1" },
        channelTgId: "-100123456",
        channelDbId: "chan-db-1",
        mediaDbId: "media-db-1",
        refMsgId: 100,
        op: "FAVORITE",
        data: { fav: true },
        db: mockDb,
      });

      assert.equal(eventMsgId, 777333, "Should return eventMsgId from DO stub");
      assert.ok(fetchCalledWith, "DO stub fetch should be called");
      assert.equal(fetchCalledWith!.headers.get("x-tg-session"), "sess-1");
      assert.equal(fetchCalledWith!.headers.get("cookie"), "session=abc");

      assert.equal(insertedRows.length, 1, "Should insert record into media_event_messages");
      assert.ok(insertedRows[0].sql.includes("INSERT OR IGNORE INTO media_event_messages"));
      assert.equal(insertedRows[0].params[1], "chan-db-1");
      assert.equal(insertedRows[0].params[2], "media-db-1");
      assert.equal(insertedRows[0].params[3], 100);
      assert.equal(insertedRows[0].params[4], 777333);
    });

    it("should trigger timeout protection and return null when DO fetch hangs indefinitely", async () => {
      // Mock DO fetch that never resolves
      const hangingStub = {
        fetch: () => new Promise<Response>(() => {}), // Never resolves
      };

      const mockAuthDo = {
        idFromName: () => "do-id-123",
        get: () => hangingStub,
      };

      const mockContext: any = {
        env: { AUTH_DO: mockAuthDo },
        req: { header: () => null },
      };

      const startTime = Date.now();
      const eventMsgId = await dispatchLedgerEvent({
        c: mockContext,
        auth: { sessionId: "sess-1" },
        channelTgId: "-100123456",
        channelDbId: "chan-db-1",
        mediaDbId: "media-db-1",
        refMsgId: 100,
        op: "FAVORITE",
        data: { fav: true },
      });

      const duration = Date.now() - startTime;
      assert.equal(eventMsgId, null, "Should return null on DO timeout");
      // Fast verification timeout check (allowing small delta around 4s timeout)
      assert.ok(duration >= 3900 && duration <= 5000, `Timeout should resolve near 4000ms (got ${duration}ms)`);
    });

    it("should dispatch batch manifest to AUTH_DO successfully and record eventMsgId in D1 for all items", async () => {
      let batchBody: any = null;

      const mockStub = {
        fetch: async (req: Request) => {
          batchBody = await req.json();
          return new Response(JSON.stringify({ success: true, eventMsgId: 555444 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      };

      const mockAuthDo = {
        idFromName: () => "do-id-123",
        get: () => mockStub,
      };

      const insertedRows: any[] = [];
      const mockDb = {
        run: async (sql: string, params: any[]) => {
          insertedRows.push({ sql, params });
          return { changes: 1 };
        },
      };

      const mockContext: any = {
        env: { AUTH_DO: mockAuthDo },
        req: { header: () => null },
      };

      const items = [
        { id: "media-item-1", telegram_message_id: 10 },
        { id: "media-item-2", telegram_message_id: 20 },
      ];

      const eventMsgId = await dispatchLedgerBatch({
        c: mockContext,
        auth: { userId: "usr-1" },
        channelTgId: "-100123456",
        channelDbId: "chan-db-1",
        items,
        ops: [{ op: "TAG_PEOPLE", refs: [10, 20], data: { people: ["Bob"] } }],
        db: mockDb,
      });

      assert.equal(eventMsgId, 555444);
      assert.equal(batchBody?.channelTgId, "-100123456");
      assert.equal(batchBody?.ops.length, 1);

      assert.equal(insertedRows.length, 2, "Should record 2 entries into media_event_messages");
      assert.equal(insertedRows[0].params[2], "media-item-1");
      assert.equal(insertedRows[0].params[4], 555444);
      assert.equal(insertedRows[1].params[2], "media-item-2");
      assert.equal(insertedRows[1].params[4], 555444);
    });
  });
});
