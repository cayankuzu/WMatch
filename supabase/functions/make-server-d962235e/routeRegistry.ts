import { SYSTEM_ROUTES, registerSystemRoutes } from "./domains/system.ts";
import { TMDB_ROUTES, registerTmdbRoutes } from "./domains/tmdb.ts";
import { AUTH_ROUTES, registerAuthRoutes } from "./domains/auth.ts";
import { PROFILE_DISCOVERY_ROUTES, registerProfileDiscoveryRoutes } from "./domains/profileDiscovery.ts";
import { SWIPE_ROUTES, registerSwipeRoutes } from "./domains/swipe.ts";
import { MATCH_ROUTES, registerMatchRoutes } from "./domains/match.ts";
import { CHAT_ROUTES, registerChatRoutes } from "./domains/chat.ts";
import { MODERATION_ROUTES, registerModerationRoutes } from "./domains/moderation.ts";
import { NOTIFICATION_ROUTES, registerNotificationRoutes } from "./domains/notification.ts";

export type EdgeRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type EdgeRouteContract = {
  readonly method: EdgeRouteMethod;
  readonly path: string;
  readonly domain: string;
};

export const EDGE_ROUTE_REGISTRY = [
  ...SYSTEM_ROUTES,
  ...TMDB_ROUTES,
  ...AUTH_ROUTES,
  ...PROFILE_DISCOVERY_ROUTES,
  ...SWIPE_ROUTES,
  ...MATCH_ROUTES,
  ...CHAT_ROUTES,
  ...MODERATION_ROUTES,
  ...NOTIFICATION_ROUTES,
] as const satisfies readonly EdgeRouteContract[];

export const registerEdgeRoutes = () => {
  registerSystemRoutes();
  registerTmdbRoutes();
  registerAuthRoutes();
  registerProfileDiscoveryRoutes();
  registerSwipeRoutes();
  registerMatchRoutes();
  registerChatRoutes();
  registerModerationRoutes();
  registerNotificationRoutes();
};
