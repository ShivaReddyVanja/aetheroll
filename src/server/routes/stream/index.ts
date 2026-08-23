import { Hono } from "hono";
import { streamRoute } from "./streamRoute.ts";

export const streamRouter = new Hono();
streamRouter.route("/", streamRoute);

export { CHUNK_SIZE, mediaObjectCache, toBigInt, getInputFileLocation, fetchTelegramChunk } from "./edgeCache.ts";
