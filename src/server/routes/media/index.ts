import { Hono } from "hono";
import { listMediaRoute } from "./listMedia.ts";
import { uploadMediaRoute } from "./uploadMedia.ts";
import { actionsMediaRoute } from "./actionsMedia.ts";
import { thumbnailMediaRoute } from "./thumbnailMedia.ts";

export const mediaRouter = new Hono();

// Mount all modular media sub-routes
mediaRouter.route("/", listMediaRoute);
mediaRouter.route("/", uploadMediaRoute);
mediaRouter.route("/", actionsMediaRoute);
mediaRouter.route("/", thumbnailMediaRoute);

export { MAX_TELEGRAM_FILE_SIZE } from "./types.ts";
