import { Hono } from "hono";
import { createShareRoute } from "./createShare";
import { listSharesRoute } from "./listShares";
import { revokeShareRoute } from "./revokeShare";
import { infoShareRoute } from "./infoShare";

export const sharesRouter = new Hono();

sharesRouter.route("/", createShareRoute);
sharesRouter.route("/", listSharesRoute);
sharesRouter.route("/", revokeShareRoute);
sharesRouter.route("/", infoShareRoute);
