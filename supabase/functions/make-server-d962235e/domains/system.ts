import {
  API_VERSION,
  RELEASE_VERSION,
  REQUIRED_SCHEMA_VERSION,
  app,
  getSchemaReady,
  getSupabase,
} from "../runtime.ts";

export const SYSTEM_ROUTES = [
  { method: "GET", path: "/make-server-d962235e/health", domain: "system" },
] as const;

export const registerSystemRoutes = () => {
  app.get("/make-server-d962235e/health", async (c) => {
    const supabase = getSupabase();
    const schemaReady = await getSchemaReady(supabase);
    const requestId = c.get("requestId") ?? crypto.randomUUID();

    return c.json({
      ok: true,
      apiVersion: API_VERSION,
      release: RELEASE_VERSION,
      requiredSchema: REQUIRED_SCHEMA_VERSION,
      serverTime: new Date().toISOString(),
      requestId,
      schemaReady,
    });
  });
};
