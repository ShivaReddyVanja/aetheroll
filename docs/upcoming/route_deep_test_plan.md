# Route Handlers Deep Test Coverage Plan

## 1. Objective
Expand the test suites for all 4 modularized route subsystems (`auth`, `channels`, `media`, `stream`) to cover **deep business logic, database queries, raw string parsers, edge cache integrations, and state mutations**, moving beyond basic 400/401/404 guard assertions.

---

## 2. Scope & Target Areas

### A. Media Routes (`src/server/routes/media/media.test.ts`)
1. **`listMedia.ts` - Raw Delimited Strings In-Memory Unpacker**:
   - Parse `people_raw` (`p.id || '::' || p.name || '::' || bx || ...`) into structured bounding boxes.
   - Parse `tags_raw` (`tg.id || '::' || tg.name || '::' || color`).
   - Parse `events_raw` and `trips_raw`.
   - Build backward-compatible `locations` array from `latitude` and `longitude`.
   - Keyset cursor pagination (verifying `nextCursor` and order by `captured_at DESC`).
   - Filtering by `person_id`, `tag_id`, `event_id`, `trip_id`, `favorites_only`, and `has_geo`.
2. **`actionsMedia.ts` - Favorite Toggle & Cascading Deletion**:
   - `POST /:id/favorite`: Verify database insertion on first call, deletion on toggle, and return payload `{ favorited: boolean }`.
   - `POST /delete`: Batch deletion across multiple IDs, verifying cascade deletes in `media_favorites`, `media_person_tags`, `media_tags`, `media_event_tags`, `trip_media`, and `media_items`.
   - R2 thumbnail key cleanup on deletion.
3. **`thumbnailMedia.ts` - Multi-Format Ingestion & Dynamic Fallback**:
   - `POST /:id/thumbnail`: Ingestion from JSON base64, multipart `FormData`, and raw `ArrayBuffer`.
   - `GET /:id/thumbnail`: R2 cache hit, Telegram photo stripped byte conversion, and SVG fallback generation with correct dimensions.
4. **`uploadMedia.ts` - Registration & Bounds**:
   - `POST /register`: D1 insertion of direct-to-Telegram uploaded media with base64 thumbnail saving to R2.
   - `POST /upload`: Rejecting payloads exceeding `MAX_TELEGRAM_FILE_SIZE` (2,000MB).

---

### B. Channels Routes (`src/server/routes/channels/channels.test.ts`)
1. **`listChannels.ts` - User Channel Isolation & Saved Messages**:
   - Automatic creation of user-scoped `me_<telegram_user_id>` private vault channel.
   - Default mode: Returning only channels linked in `gallery_channels` for the requesting user.
   - `all=true` mode: Returning all Telegram channels with `is_added` flag.
2. **`manageChannels.ts` - Add & Remove Operations**:
   - `POST /add`: Upsert channel and insert into `gallery_channels`.
   - `POST /remove`: Remove from `gallery_channels` while keeping `me` protected.
3. **`syncChannel.ts` - 2-Way Sync & Ledger Replay**:
   - Parsing and filtering non-Aetheroll media items via cryptographic signature.
   - 2-way pruning of media deleted directly in Telegram.
   - Orphaned WAL event message cleanup from Telegram chat.
   - Replaying valid event sourcing ledger into D1 database.

---

### C. Auth Routes (`src/server/routes/auth/auth.test.ts`)
1. **`sessionRoutes.ts` - Session Lifecycle**:
   - `POST /session`: Validating composite tokens (`sessionId.clientSecret`), querying `user_sessions`, and verifying `.builtbyshiva.com` domain cookie attributes.
   - `GET /me`: Returning full profile for authenticated session.
   - `POST /logout`: Removing `user_sessions` from D1 and expiring the `tg_session` cookie.
   - `GET /client-session`: Returning decrypted session credentials for direct browser-to-Telegram WebSocket uploads.
2. **`qrPolling.ts` - QR Challenge Lifecycle**:
   - Memory session creation on `GET /qr`.
   - Dual-key zero-knowledge token generation and session storage on `POST /qr/check`.

---

### D. Stream Routes (`src/server/routes/stream/stream.test.ts`)
1. **`edgeCache.ts` - Chunk & Location Parsing**:
   - Document and Photo `InputFileLocation` resolution.
   - 512KB Telegram chunk offset calculations.
2. **`streamRoute.ts` - Edge Cache & Browser Disconnects**:
   - Sub-3ms Edge Cache lookup and `x-edge-cache: HIT` header injection.
   - Forwarding to `AUTH_DO` with `x-edge-cache: MISS` and `Accept-Ranges: bytes`.
   - Browser abort signal handling (`499` client closed request).

---

## 3. Execution Strategy
1. Build reusable mock database helper (`createRouteMockDb`) capable of in-memory SQL parsing (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `JOIN`, `GROUP_CONCAT`).
2. Implement isolated test suites per route submodule inside their respective directories (`auth.test.ts`, `channels.test.ts`, `media.test.ts`, `stream.test.ts`).
3. Verify test runs with `npm test`, `npm run test:unit`, and `npx tsc --noEmit`.
