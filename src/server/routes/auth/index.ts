import { Hono } from "hono";
import { qrStreamRoute } from "./qrStream.ts";
import { qrPollingRoute } from "./qrPolling.ts";
import { phoneAuthRoute } from "./phoneAuth.ts";
import { sessionRoutes } from "./sessionRoutes.ts";
import { wsRoute } from "./wsRoute.ts";

export const authRouter = new Hono();

// Mount all modular auth sub-routes
authRouter.route("/", qrStreamRoute);
authRouter.route("/", qrPollingRoute);
authRouter.route("/", phoneAuthRoute);
authRouter.route("/", sessionRoutes);
authRouter.route("/", wsRoute);
