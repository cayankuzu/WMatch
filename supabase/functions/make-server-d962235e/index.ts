import { API_VERSION, app, registerSharedMiddleware } from "./runtime.ts";
import { EDGE_ROUTE_REGISTRY, registerEdgeRoutes } from "./routeRegistry.ts";

registerSharedMiddleware(API_VERSION);
registerEdgeRoutes();

if (EDGE_ROUTE_REGISTRY.length !== 41) {
  throw new Error(`Edge route registry mismatch: expected 41, received ${EDGE_ROUTE_REGISTRY.length}`);
}

Deno.serve(app.fetch);
