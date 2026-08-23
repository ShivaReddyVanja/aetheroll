import { Hono } from "hono";
import { listChannelsRoute } from "./listChannels.ts";
import { manageChannelsRoute } from "./manageChannels.ts";
import { syncChannelRoute } from "./syncChannel.ts";

export const channelsRouter = new Hono();

// Mount modular sub-routes
channelsRouter.route("/", listChannelsRoute);
channelsRouter.route("/", manageChannelsRoute);
channelsRouter.route("/", syncChannelRoute);
