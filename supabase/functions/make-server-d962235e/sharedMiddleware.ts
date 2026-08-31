import { Hono, type Context, type Next } from "npm:hono@4.13.3";
import { createClient } from "jsr:@supabase/supabase-js@2.107.0";

import {
  getRequestRateLimitIdentity as resolveRequestRateLimitIdentity,
  normalizeRequestId,
} from "./httpSecurity.ts";
import { createOriginHmacMiddleware, getVerifiedOriginClientIdentity } from "./originHmac.ts";
import type { Database } from "../../types/database.generated.ts";

export type AppVariables = {
  userId: string;
  requestId: string;
  requestStartedAt: number;
};

export type AppContext = Context<{ Variables: AppVariables }>;

export const app = new Hono<{ Variables: AppVariables }>();

export const getSupabase = () =>
  createClient<Database>(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SECRET_KEY") ??
      "",
  );

export type SupabaseAdminClient = ReturnType<typeof getSupabase>;

const TRUSTED_CLIENT_IP_HEADER = (Deno.env.get("TRUSTED_CLIENT_IP_HEADER") ?? "")
  .trim()
  .toLowerCase();

export const getRequestRateLimitIdentity = (c: AppContext) =>
  getVerifiedOriginClientIdentity(c.req.raw)
  ?? resolveRequestRateLimitIdentity(c.req, TRUSTED_CLIENT_IP_HEADER);

export const getPathParam = (c: AppContext, name: string) => c.req.param(name) ?? "";

export const enforceRateLimit = async (
  supabase: SupabaseAdminClient,
  config: {
    action: string;
    key: string;
    limit: number;
    windowSeconds: number;
  },
) => {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_action: config.action,
    p_key: config.key,
    p_limit: config.limit,
    p_window_seconds: config.windowSeconds,
  });

  if (error) {
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Number(result?.retry_after_seconds ?? config.windowSeconds),
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
};

export const authMiddleware = async (c: AppContext, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Oturum doğrulanamadı." }, 401);
  }

  const token = authHeader.split(" ")[1];
  const supabase = getSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
      return c.json({ error: "Oturum anahtarı geçersiz." }, 401);
  }

  c.set("userId", user.id);
  await next();
};

let sharedMiddlewareRegistered = false;

export const registerSharedMiddleware = (apiVersion: string) => {
  if (sharedMiddlewareRegistered) {
    return;
  }

  sharedMiddlewareRegistered = true;
  app.use("*", async (c, next) => {
    const requestId = normalizeRequestId(c.req.header("x-request-id")) ?? crypto.randomUUID();
    const startedAt = Date.now();

    c.set("requestId", requestId);

    try {
      await next();
    } finally {
      let actor = "anonymous";

      try {
        const userId = c.get("userId");
        if (typeof userId === "string" && userId.length > 0) {
          actor = `user:${userId.slice(0, 8)}`;
        }
      } catch {
        actor = "anonymous";
      }

      c.res.headers.set("x-request-id", requestId);
      c.res.headers.set("x-api-version", apiVersion);
      c.res.headers.set("x-server-time", new Date().toISOString());
      c.res.headers.set("Cache-Control", "private, no-store, max-age=0");
      c.res.headers.set("Pragma", "no-cache");
      c.res.headers.append("Vary", "Authorization");

      console.log(JSON.stringify({
        requestId,
        route: c.req.path,
        method: c.req.method,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
        actor,
      }));
    }
  });

  app.use("*", createOriginHmacMiddleware((args) =>
    getSupabase().rpc("claim_edge_origin_hmac_nonce", args)
  ));
};
