import {
  MATCH_SELECT,
  MAX_BLOCK_MUTATIONS_PER_MINUTE,
  MAX_RELATIONSHIP_ROWS,
  app,
  authMiddleware,
  buildAbuseKey,
  enforceRateLimit,
  getPathParam,
  getRequestRateLimitIdentity,
  getSupabase,
  loadUserPayloadMap,
  queueChatStatusNotification,
  queuePairStateEvents,
} from "../runtime.ts";
import type {
  DatabaseRow,
} from "../runtime.ts";

export const MATCH_ROUTES = [
  { method: "GET", path: "/make-server-d962235e/matches", domain: "match" },
  { method: "PUT", path: "/make-server-d962235e/matches/status", domain: "match" },
  { method: "GET", path: "/make-server-d962235e/blocks", domain: "match" },
  { method: "POST", path: "/make-server-d962235e/blocks/:userId", domain: "match" },
  { method: "DELETE", path: "/make-server-d962235e/blocks/:userId", domain: "match" },
] as const;

export const registerMatchRoutes = () => {
  app.get("/make-server-d962235e/matches", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();

      const { data: matches, error } = await supabase
        .from("matches")
        .select(MATCH_SELECT)
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
        .order("created_at", { ascending: false })
        .limit(MAX_RELATIONSHIP_ROWS);

      if (error) {
        console.error("Get matches error:", error);
        return c.json({ error: "Eşleşmeler yüklenemedi." }, 500);
      }

      return c.json({ matches: matches ?? [] });
    } catch (error) {
      console.error("Get matches error:", error);
      return c.json({ error: "Eşleşmeler yüklenemedi." }, 500);
    }
  });

  app.put("/make-server-d962235e/matches/status", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const { user1Id, user2Id, action } = await c.req.json();
      const supabase = getSupabase();

      if (!user1Id || !user2Id || !["end", "block", "unblock"].includes(action)) {
        return c.json({ error: "Eşleşme durumu isteği geçersiz." }, 400);
      }

      if (currentUserId !== user1Id && currentUserId !== user2Id) {
        return c.json({ error: "Bu eşleşmeyi güncelleyemezsin." }, 403);
      }

      const otherUserId = currentUserId === user1Id ? user2Id : user1Id;
      const { data: relationshipRows, error: relationshipError } = await supabase.rpc(
        "update_pair_relationship_atomic",
        {
          p_actor_user_id: currentUserId,
          p_target_user_id: otherUserId,
          p_action: action,
        },
      );

      if (relationshipError) {
        console.error("Atomic match update error:", relationshipError);
        return c.json({ error: "Eşleşme güncellenemedi." }, 500);
      }

      const relationship = Array.isArray(relationshipRows) ? relationshipRows[0] : relationshipRows;
      if (!relationship || relationship.outcome === "missing_match") {
        return c.json({ error: "Eşleşme bulunamadı." }, 404);
      }

      const notificationKind = action === "block"
        ? "chat_blocked"
        : action === "unblock"
          ? "chat_unblocked"
          : "chat_ended";
      const eventReason = action === "block"
        ? "match_blocked"
        : action === "unblock"
          ? "match_unblocked"
          : "match_ended";

      queueChatStatusNotification(supabase, {
        recipientUserId: otherUserId,
        actorUserId: currentUserId,
        kind: notificationKind,
      });

      queuePairStateEvents(supabase, currentUserId, otherUserId, eventReason);
      return c.json({ success: true });
    } catch (error) {
      console.error("Update match error:", error);
      return c.json({ error: "Eşleşme güncellenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/blocks", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();

      const { data: blockRows, error } = await supabase
        .from("user_blocks")
        .select("blocked_id, created_at")
        .eq("blocker_id", currentUserId)
        .order("created_at", { ascending: false })
        .limit(MAX_RELATIONSHIP_ROWS);

      if (error) {
        console.error("Get blocks error:", error);
        return c.json({ error: "Engellenen kullanıcılar yüklenemedi." }, 500);
      }

      const blockedUserIds: string[] = (blockRows ?? []).map((row: { blocked_id: string }) => row.blocked_id);
      const userMap = await loadUserPayloadMap(supabase, blockedUserIds);

      return c.json({
        users: blockedUserIds
          .map((userId: string) => userMap.get(userId))
          .filter((user: DatabaseRow | undefined): user is DatabaseRow => user != null),
      });
    } catch (error) {
      console.error("Get blocks error:", error);
      return c.json({ error: "Engellenen kullanıcılar yüklenemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/blocks/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const blockedUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      if (!blockedUserId || blockedUserId === currentUserId) {
        return c.json({ error: "Geçersiz engelleme isteği." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "block_user",
        key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_BLOCK_MUTATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const { data: blockRows, error: blockError } = await supabase.rpc(
        "update_pair_relationship_atomic",
        {
          p_actor_user_id: currentUserId,
          p_target_user_id: blockedUserId,
          p_action: "block",
        },
      );

      if (blockError) {
        console.error("Atomic user block error:", blockError);
        return c.json({ error: "Kullanıcı engellenemedi." }, 500);
      }

      const blockResult = Array.isArray(blockRows) ? blockRows[0] : blockRows;
      if (!blockResult) {
        return c.json({ error: "Engelleme işlemi doğrulanamadı." }, 500);
      }

      if (blockResult.match_status) {
        queueChatStatusNotification(supabase, {
          recipientUserId: blockedUserId,
          actorUserId: currentUserId,
          kind: "chat_blocked",
        });
      }

      queuePairStateEvents(supabase, currentUserId, blockedUserId, "user_blocked");
      return c.json({ success: true });
    } catch (error) {
      console.error("Block user error:", error);
      return c.json({ error: "Kullanıcı engellenemedi." }, 500);
    }
  });

  app.delete("/make-server-d962235e/blocks/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const blockedUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      const rateLimit = await enforceRateLimit(supabase, {
        action: "unblock_user",
        key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_BLOCK_MUTATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const { data: unblockRows, error: unblockError } = await supabase.rpc(
        "update_pair_relationship_atomic",
        {
          p_actor_user_id: currentUserId,
          p_target_user_id: blockedUserId,
          p_action: "unblock",
        },
      );

      if (unblockError) {
        console.error("Atomic user unblock error:", unblockError);
        return c.json({ error: "Kullanıcının engeli kaldırılamadı." }, 500);
      }

      const unblockResult = Array.isArray(unblockRows) ? unblockRows[0] : unblockRows;
      if (!unblockResult) {
        return c.json({ error: "Engel kaldırma işlemi doğrulanamadı." }, 500);
      }

      if (unblockResult.match_status) {
        queueChatStatusNotification(supabase, {
          recipientUserId: blockedUserId,
          actorUserId: currentUserId,
          kind: "chat_unblocked",
        });
      }

      queuePairStateEvents(supabase, currentUserId, blockedUserId, "user_unblocked");
      return c.json({ success: true });
    } catch (error) {
      console.error("Unblock user error:", error);
      return c.json({ error: "Kullanıcının engeli kaldırılamadı." }, 500);
    }
  });
};
