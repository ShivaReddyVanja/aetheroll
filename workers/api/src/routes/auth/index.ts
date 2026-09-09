import { Hono } from "hono";
import { qrStreamRoute } from "./qrStream";
import { qrPollingRoute } from "./qrPolling";
import { phoneAuthRoute } from "./phoneAuth";
import { sessionRoutes } from "./sessionRoutes";
import { wsRoute } from "./wsRoute";

export const authRouter = new Hono();

// Mount all modular auth sub-routes
authRouter.route("/", qrStreamRoute);
authRouter.route("/", qrPollingRoute);
authRouter.route("/", phoneAuthRoute);
authRouter.route("/", sessionRoutes);
authRouter.route("/", wsRoute);
