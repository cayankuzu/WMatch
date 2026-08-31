import {
  MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE,
  app,
  authMiddleware,
  buildAbuseKey,
  drainPushDeliveryOutbox,
  drainPushDeliveryReceipts,
  enforceRateLimit,
  getPathParam,
  getPushDeliveryHealth,
  getRequestRateLimitIdentity,
  getSupabase,
  isMissingRelationError,
} from "../runtime.ts";

export const NOTIFICATION_ROUTES = [
  { method: "POST", path: "/make-server-d962235e/notifications/push-outbox/drain", domain: "notification" },
  { method: "POST", path: "/make-server-d962235e/notifications/push-token", domain: "notification" },
  { method: "DELETE", path: "/make-server-d962235e/notifications/push-token", domain: "notification" },
  { method: "PUT", path: "/make-server-d962235e/notifications/events/:eventId/read", domain: "notification" },
] as const;

export const registerNotificationRoutes = () => {
  app.post("/make-server-d962235e/notifications/push-outbox/drain", async (c) => {
    const configuredSecret = Deno.env.get("NOTIFICATION_WORKER_SECRET")?.trim();
    const providedSecret = c.req.header("X-WMatch-Worker-Secret")?.trim();

    if (!configuredSecret) {
        return c.json({ error: "Bildirim teslim hizmeti yapılandırılmamış." }, 503);
    }

    if (!providedSecret || providedSecret !== configuredSecret) {
        return c.json({ error: "Bu işlem için yetkin yok." }, 401);
    }

    try {
      const supabase = getSupabase();
      const processed = await drainPushDeliveryOutbox(supabase);
      const receiptsProcessed = await drainPushDeliveryReceipts(supabase);
      const health = await getPushDeliveryHealth(supabase);
      return c.json({
        success: true,
        processed,
        receiptsProcessed,
        healthy:
          health.dead === 0
          && health.stalled === 0
          && health.receiptFailed === 0
          && health.receiptStalled === 0,
        health,
      });
    } catch (error) {
      console.error("Push outbox drain error:", error);
        return c.json({ error: "Bildirim teslimi yeniden denenemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/notifications/push-token", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const body = await c.req.json().catch(() => ({}));
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      const platform = typeof body?.platform === "string" ? body.platform.trim().toLowerCase() : "unknown";

      if (!token || (!token.startsWith("ExpoPushToken[") && !token.startsWith("ExponentPushToken["))) {
        return c.json({ error: "Geçersiz bildirim anahtarı." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "register_push_token",
        key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const normalizedPlatform =
        platform === "ios" || platform === "android" ? platform : "unknown";

      const { error } = await supabase.from("device_push_tokens").upsert({
        token,
        user_id: currentUserId,
        platform: normalizedPlatform,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.error("Register push token error:", error);
        return c.json({ error: "Bildirim anahtarı kaydedilemedi." }, 400);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("Register push token error:", error);
      return c.json({ error: "Bildirim anahtarı kaydedilemedi." }, 500);
    }
  });

  app.delete("/make-server-d962235e/notifications/push-token", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const body = await c.req.json().catch(() => ({}));
      const token = typeof body?.token === "string" ? body.token.trim() : "";

      const rateLimit = await enforceRateLimit(supabase, {
        action: "delete_push_token",
        key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c), token]),
        limit: MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      let query = supabase.from("device_push_tokens").delete().eq("user_id", currentUserId);

      if (token) {
        query = query.eq("token", token);
      }

      const { error } = await query;

      if (error) {
        console.error("Delete push token error:", error);
        return c.json({ error: "Bildirim anahtarı kaldırılamadı." }, 400);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("Delete push token error:", error);
      return c.json({ error: "Bildirim anahtarı kaldırılamadı." }, 500);
    }
  });

  app.put("/make-server-d962235e/notifications/events/:eventId/read", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const eventId = getPathParam(c, "eventId");
      const supabase = getSupabase();

      const { error } = await supabase
        .from("notification_events")
        .update({ read_at: new Date().toISOString() })
        .eq("id", eventId)
        .eq("user_id", currentUserId)
        .is("read_at", null);

      if (error) {
        if (isMissingRelationError(error, "notification_events")) {
          return c.json({ success: true, skipped: true });
        }

        console.error("Mark notification event read error:", error);
        return c.json({ error: "Bildirim okundu olarak işaretlenemedi." }, 400);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("Mark notification event read error:", error);
      return c.json({ error: "Bildirim okundu olarak işaretlenemedi." }, 500);
    }
  });
};
