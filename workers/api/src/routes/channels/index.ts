import { Hono } from "hono";
import { listChannelsRoute } from "./listChannels";
import { manageChannelsRoute } from "./manageChannels";
import { syncChannelRoute } from "./syncChannel";

export const channelsRouter = new Hono();

// Mount modular sub-routes
channelsRouter.route("/", listChannelsRoute);
channelsRouter.route("/", manageChannelsRoute);
channelsRouter.route("/", syncChannelRoute);
