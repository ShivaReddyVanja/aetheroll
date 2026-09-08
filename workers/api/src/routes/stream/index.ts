import { Hono } from "hono";
import { streamRoute } from "./streamRoute";

export const streamRouter = new Hono();
streamRouter.route("/", streamRoute);

export { CHUNK_SIZE, mediaObjectCache, toBigInt, getInputFileLocation, fetchTelegramChunk } from "./edgeCache";
