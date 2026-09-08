import { Hono } from "hono";
import { listMediaRoute } from "./listMedia";
import { uploadMediaRoute } from "./uploadMedia";
import { actionsMediaRoute } from "./actionsMedia";
import { thumbnailMediaRoute } from "./thumbnailMedia";

export const mediaRouter = new Hono();

// Mount all modular media sub-routes
mediaRouter.route("/", listMediaRoute);
mediaRouter.route("/", uploadMediaRoute);
mediaRouter.route("/", actionsMediaRoute);
mediaRouter.route("/", thumbnailMediaRoute);

export { MAX_TELEGRAM_FILE_SIZE } from "./types";
