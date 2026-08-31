import {
  DAILY_LIKE_SWIPE_LIMIT,
  DAILY_UNDO_LIMIT,
  MATCH_LIKE_REWARD_BONUS,
  MAX_CHAT_MUTATIONS_PER_MINUTE,
  MAX_LIKES_PER_MINUTE,
  MAX_RELATIONSHIP_ROWS,
  SWIPE_QUOTA_WINDOW_HOURS,
  app,
  authMiddleware,
  buildAbuseKey,
  buildLikeNotificationBody,
  consumeSwipeQuota,
  dispatchNotificationEvents,
  enforceRateLimit,
  fetchActiveMatchedUserIdsForUser,
  fetchBlockedUserIdsForUser,
  fetchLikeSets,
  fetchMatchBetweenUsers,
  getMatchNotificationBody,
  getPathParam,
  getRequestRateLimitIdentity,
  getSupabase,
  hashIdempotencyPayload,
  isMissingColumnError,
  isMissingRelationError,
  loadProfileNameMap,
  loadSwipeQuotaRow,
  loadUserPayloadMap,
  normalizeIdempotencyKey,
  normalizeMatchSourceType,
  normalizeSwipeQuotaRow,
  publishUserEvents,
  queueUserEvents,
  reconcileMutualLikesForUser,
  rewardSwipeQuota,
  runAfterResponse,
  serializeSwipeQuota,
  userHasIncomingLikesEntitlement,
} from "../runtime.ts";
import type {
  DatabaseRow,
} from "../runtime.ts";

export const SWIPE_ROUTES = [
  { method: "GET", path: "/make-server-d962235e/swipe-quota", domain: "swipe" },
  { method: "POST", path: "/make-server-d962235e/swipe-quota/consume", domain: "swipe" },
  { method: "POST", path: "/make-server-d962235e/likes/:userId", domain: "swipe" },
  { method: "POST", path: "/make-server-d962235e/likes/:userId/undo", domain: "swipe" },
  { method: "DELETE", path: "/make-server-d962235e/likes/:userId", domain: "swipe" },
  { method: "DELETE", path: "/make-server-d962235e/likes/incoming/:userId", domain: "swipe" },
  { method: "PUT", path: "/make-server-d962235e/likes/incoming/:userId/restore", domain: "swipe" },
  { method: "GET", path: "/make-server-d962235e/likes", domain: "swipe" },
  { method: "GET", path: "/make-server-d962235e/discovery/likes", domain: "swipe" },
] as const;

export const registerSwipeRoutes = () => {
  app.get("/make-server-d962235e/swipe-quota", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const quota = await loadSwipeQuotaRow(supabase, currentUserId);
      return c.json(serializeSwipeQuota(quota));
    } catch (error) {
      console.error("Get swipe quota error:", error);
      return c.json({ error: "Kaydırma kotası yüklenemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/swipe-quota/consume", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const body: { kind?: unknown } = await c.req.json().catch(() => ({}));
      const kind = body?.kind;

      if (kind !== "like" && kind !== "dislike" && kind !== "undo") {
        return c.json({ error: "Geçersiz kaydırma kotası isteği." }, 400);
      }

      const nextQuota = await consumeSwipeQuota(supabase, currentUserId, kind);

      if (!nextQuota) {
        const messages = {
          like: "Günlük beğeni hakkın doldu.",
          dislike: "Günlük beğenmeme hakkın doldu.",
          undo: "Günlük geri alma hakkın doldu.",
        } as const;

        return c.json({ error: `${messages[kind]} Yenilenmeyi beklemelisin.` }, 429);
      }

      return c.json(serializeSwipeQuota(nextQuota));
    } catch (error) {
      console.error("Consume swipe quota error:", error);
      return c.json({ error: "Kaydırma kotası güncellenemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/likes/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const likedUserId = getPathParam(c, "userId");
      const body = await c.req.json().catch(() => ({}));
      const sourceType = normalizeMatchSourceType(body?.source);
      const supabase = getSupabase();
      const rawIdempotencyKey = c.req.header("Idempotency-Key");
      const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

      if (!likedUserId || likedUserId === currentUserId) {
        return c.json({ error: "Geçersiz beğeni isteği." }, 400);
      }

      if (rawIdempotencyKey && !idempotencyKey) {
        return c.json({ error: "Geçersiz idempotency anahtarı." }, 400);
      }

      let rateLimit = {
        allowed: true,
        retryAfterSeconds: 0,
      };

      try {
        rateLimit = await enforceRateLimit(supabase, {
          action: "like_user",
          key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
          limit: MAX_LIKES_PER_MINUTE,
          windowSeconds: 60,
        });
      } catch (rateLimitError) {
        console.error("Like rate limit error:", rateLimitError);
        return c.json({ error: "Beğeni güvenlik kontrolü şu anda tamamlanamıyor. Lütfen tekrar dene." }, 503);
      }

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı beğeni gönderiyorsun. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const atomicLikeParams = {
        p_actor_user_id: currentUserId,
        p_target_user_id: likedUserId,
        p_source_type: sourceType,
        p_window_hours: SWIPE_QUOTA_WINDOW_HOURS,
        p_like_limit: DAILY_LIKE_SWIPE_LIMIT,
      };
      const { data: atomicRows, error: atomicLikeError } = idempotencyKey
        ? await supabase.rpc("process_like_action_idempotent", {
            ...atomicLikeParams,
            p_idempotency_key: idempotencyKey,
            p_payload_hash: await hashIdempotencyPayload(`${likedUserId}:${sourceType}`),
          })
        : await supabase.rpc("process_like_action_atomic", atomicLikeParams);

      if (atomicLikeError) {
        console.error("Atomic like error:", atomicLikeError);
        return c.json({ error: "Beğeni kaydedilemedi." }, 500);
      }

      const atomicLike = Array.isArray(atomicRows) ? atomicRows[0] : atomicRows;

      if (!atomicLike) {
        return c.json({ error: "Beğeni işlemi doğrulanamadı." }, 500);
      }

      if (atomicLike.outcome === "blocked") {
        return c.json({ error: "Bu kullanıcı ile etkileşime geçemezsin." }, 403);
      }

      if (atomicLike.outcome === "quota_exhausted") {
        return c.json({ error: "Günlük beğeni hakkın doldu. Yenilenmeyi beklemelisin." }, 429);
      }

      const matchBecameActive = atomicLike.match_became_active === true;
      const matched = atomicLike.matched === true;
      const createdLike = atomicLike.outcome === "liked" || matchBecameActive;
      const idempotencyReplayed =
        "idempotency_replayed" in atomicLike && atomicLike.idempotency_replayed === true;
      const quotaRowForResponse = normalizeSwipeQuotaRow(currentUserId, atomicLike);
      if ((createdLike || matchBecameActive) && !idempotencyReplayed) {
        const discoveryEventTask = publishUserEvents(
          supabase,
          [currentUserId, likedUserId],
          "discovery_changed",
          { reason: matchBecameActive ? "match" : "like" },
        ).catch((eventError) => {
          console.error("Discovery event broadcast error:", eventError);
        });

        if (!runAfterResponse(discoveryEventTask)) {
          void discoveryEventTask;
        }
      }

      if (matchBecameActive && !idempotencyReplayed) {
        const quotaRewardTask = rewardSwipeQuota(supabase, likedUserId, "like").catch((quotaRewardError) => {
          console.error("Peer match quota reward error:", quotaRewardError);
        });

        if (!runAfterResponse(quotaRewardTask)) {
          void quotaRewardTask;
        }

        const matchNotificationTask = (async () => {
          const nameMap = await loadProfileNameMap(supabase, [currentUserId]);
          const currentUserName = nameMap.get(currentUserId) ?? "bir kullanıcı";
          const currentUser = { name: currentUserName };

          await dispatchNotificationEvents(supabase, [
            {
              userId: likedUserId,
              title: "Yeni eşleşme",
              body: getMatchNotificationBody(
                sourceType,
                currentUser?.name ?? "bir kullanıcı",
              ),
              actorUserId: currentUserId,
              kind: "match",
              routeKind: "chat",
              routeUserId: currentUserId,
              payload: { sourceType },
            },
          ], { deferPush: true });
        })().catch((matchNotificationError) => {
          console.error("Match notification side effect error:", matchNotificationError);
        });

        if (!runAfterResponse(matchNotificationTask)) {
          void matchNotificationTask;
        }
      }

      if (!matched && createdLike && !idempotencyReplayed) {
        const likeNotificationTask = dispatchNotificationEvents(supabase, [
          {
            userId: likedUserId,
            actorUserId: currentUserId,
            kind: "like",
            routeKind: "likes",
            title: "Yeni begeni",
            body: buildLikeNotificationBody(),
            payload: { preferredTab: "likedme", sourceType },
          },
        ], { deferPush: true }).catch((likeNotificationError) => {
          console.error("Like notification side effect error:", likeNotificationError);
        });

        if (!runAfterResponse(likeNotificationTask)) {
          void likeNotificationTask;
        }
      }

      if (matched) {
        const hiddenChatCleanupTask = supabase
          .from("hidden_chats")
          .delete()
          .or(
            `and(user_id.eq.${currentUserId},other_user_id.eq.${likedUserId}),and(user_id.eq.${likedUserId},other_user_id.eq.${currentUserId})`,
          )
          .then(({ error }: { error?: unknown }) => {
            if (error) {
              console.error("Hidden chat cleanup error after like:", error);
            }
          });

        if (!runAfterResponse(hiddenChatCleanupTask)) {
          void hiddenChatCleanupTask;
        }
      }

      const quotaPayload = serializeSwipeQuota(quotaRowForResponse);

      return c.json({
        success: true,
        matched,
        matchedUser: null,
        rewardLikes: atomicLike.reward_granted === true ? MATCH_LIKE_REWARD_BONUS : 0,
        quota: quotaPayload,
      });
    } catch (error) {
      console.error("Like error:", error);
      return c.json({ error: "Beğeni işlemi tamamlanamadı." }, 500);
    }
  });

  app.post("/make-server-d962235e/likes/:userId/undo", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const likedUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      if (!likedUserId || likedUserId === currentUserId) {
        return c.json({ error: "Geçersiz geri alma isteği." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "undo_like",
        key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı geri alma isteği gönderiyorsun. Lütfen biraz bekle." }, 429);
      }

      const { data, error } = await supabase.rpc("undo_like_action_atomic", {
        p_actor_user_id: currentUserId,
        p_target_user_id: likedUserId,
        p_window_hours: SWIPE_QUOTA_WINDOW_HOURS,
        p_undo_limit: DAILY_UNDO_LIMIT,
      });

      if (error) {
        console.error("Atomic like undo error:", error);
        return c.json({ error: "Beğeni geri alınamadı." }, 500);
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        return c.json({ error: "Geri alma işlemi doğrulanamadı." }, 500);
      }

      if (result.outcome === "active_match") {
        return c.json({ error: "Aktif bir eşleşme geri alma ile bozulamaz." }, 409);
      }

      if (result.outcome === "quota_exhausted") {
        return c.json({ error: "Günlük geri alma hakkın doldu. Yenilenmeyi beklemelisin." }, 429);
      }

      const discoveryEventTask = publishUserEvents(
        supabase,
        [currentUserId, likedUserId],
        "discovery_changed",
        { reason: "like_undo" },
      ).catch((eventError) => {
        console.error("Like undo discovery event error:", eventError);
      });

      if (!runAfterResponse(discoveryEventTask)) {
        void discoveryEventTask;
      }

      return c.json({
        success: true,
        alreadyUndone: result.outcome === "missing",
        quota: serializeSwipeQuota(normalizeSwipeQuotaRow(currentUserId, result)),
      });
    } catch (error) {
      console.error("Atomic like undo error:", error);
      return c.json({ error: "Beğeni geri alınamadı." }, 500);
    }
  });

  app.delete("/make-server-d962235e/likes/:userId", authMiddleware, async (c) => {
      try {
        const currentUserId = c.get("userId");
        const likedUserId = getPathParam(c, "userId");
        const supabase = getSupabase();

        const existingMatch = await fetchMatchBetweenUsers(supabase, currentUserId, likedUserId);
        if (existingMatch && existingMatch.status === "active") {
          return c.json({ error: "Aktif eşleşme geri alma ile bozulamaz." }, 409);
        }

        const { error } = await supabase
          .from("likes")
          .delete()
          .eq("user_id", currentUserId)
        .eq("liked_user_id", likedUserId);

      if (error) {
        console.error("Unlike error:", error);
        return c.json({ error: "Beğeni geri alınamadı." }, 400);
      }

        const remainingMatch = await fetchMatchBetweenUsers(supabase, currentUserId, likedUserId);
      if (remainingMatch && remainingMatch.status === "active") {
        const { data: reverseLike, error: reverseLikeError } = await supabase
          .from("likes")
          .select("user_id")
          .eq("user_id", likedUserId)
          .eq("liked_user_id", currentUserId)
          .maybeSingle();

        if (reverseLikeError) {
          console.error("Unlike reverse like check error:", reverseLikeError);
        return c.json({ error: "Karşı beğeni kontrolü yapılamadı." }, 400);
        }

        if (!reverseLike) {
          const { error: matchEndError } = await supabase
            .from("matches")
            .update({
              status: "ended",
              ended_at: new Date().toISOString(),
              ended_by_user_id: currentUserId,
            })
            .eq("user1_id", remainingMatch.user1_id)
            .eq("user2_id", remainingMatch.user2_id);

          if (matchEndError) {
            console.error("Unlike match end error:", matchEndError);
        return c.json({ error: "Eşleşme sonlandırılamadı." }, 400);
          }
        }
      }

      queueUserEvents(supabase, [currentUserId, likedUserId], "discovery_changed", { reason: "unlike" });
      queueUserEvents(supabase, [currentUserId, likedUserId], "chat_changed", { reason: "unlike" });
      return c.json({ success: true });
    } catch (error) {
      console.error("Unlike error:", error);
      return c.json({ error: "Beğeni geri alma işlemi tamamlanamadı." }, 500);
    }
  });

  app.delete("/make-server-d962235e/likes/incoming/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const senderUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      if (!senderUserId || senderUserId === currentUserId) {
        return c.json({ error: "Geçersiz beğeni kaldırma isteği." }, 400);
      }

      let rateLimit = {
        allowed: true,
        retryAfterSeconds: 0,
      };

      try {
        rateLimit = await enforceRateLimit(supabase, {
          action: "reject_incoming_like",
          key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
          limit: MAX_LIKES_PER_MINUTE,
          windowSeconds: 60,
        });
      } catch (rateLimitError) {
        console.error("Reject incoming like rate limit fallback error:", rateLimitError);
      }

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const { error } = await supabase
        .from("likes")
        .update({ hidden_by_liked_user: true })
        .eq("user_id", senderUserId)
        .eq("liked_user_id", currentUserId);

      if (error) {
        if (isMissingColumnError(error, "hidden_by_liked_user")) {
          const fallbackDelete = await supabase
            .from("likes")
            .delete()
            .eq("user_id", senderUserId)
            .eq("liked_user_id", currentUserId);

          if (fallbackDelete.error) {
            console.error("Reject incoming like fallback delete error:", fallbackDelete.error);
        return c.json({ error: "Gelen beğeni kaldırılamadı." }, 400);
          }

          queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
            reason: "incoming_like_hidden",
          });
          return c.json({ success: true });
        }

        console.error("Reject incoming like error:", error);
      return c.json({ error: "Gelen beğeni kaldırılamadı." }, 400);
      }

      queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
        reason: "incoming_like_hidden",
      });
      return c.json({ success: true });
    } catch (error) {
      console.error("Reject incoming like error:", error);
      return c.json({ error: "Gelen beğeni kaldırılamadı." }, 500);
    }
  });

  app.put("/make-server-d962235e/likes/incoming/:userId/restore", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const senderUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      if (!senderUserId || senderUserId === currentUserId) {
        return c.json({ error: "Geçersiz beğeni geri alma isteği." }, 400);
      }

      const { error } = await supabase
        .from("likes")
        .update({ hidden_by_liked_user: false })
        .eq("user_id", senderUserId)
        .eq("liked_user_id", currentUserId);

      if (error) {
        if (isMissingColumnError(error, "hidden_by_liked_user")) {
          queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
            reason: "incoming_like_restored",
          });
          return c.json({ success: true });
        }

        console.error("Restore incoming like error:", error);
      return c.json({ error: "Gelen beğeni geri yüklenemedi." }, 400);
      }

      queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
        reason: "incoming_like_restored",
      });
      return c.json({ success: true });
    } catch (error) {
      console.error("Restore incoming like error:", error);
      return c.json({ error: "Gelen beğeni geri yüklenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/likes", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();

      const loadLikedByRows = async () => {
        const { data, error } = await supabase
          .from("likes")
          .select("user_id")
          .eq("liked_user_id", currentUserId)
          .eq("hidden_by_liked_user", false)
          .limit(MAX_RELATIONSHIP_ROWS);

        if (!error) {
          return data ?? [];
        }

        if (isMissingColumnError(error, "hidden_by_liked_user")) {
          const fallback = await supabase
            .from("likes")
            .select("user_id")
            .eq("liked_user_id", currentUserId)
            .limit(MAX_RELATIONSHIP_ROWS);

          if (fallback.error) {
            throw fallback.error;
          }

          return fallback.data ?? [];
        }

        throw error;
      };

      const loadBlockRows = async () => {
        const { data, error } = await supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`)
          .limit(MAX_RELATIONSHIP_ROWS);

        if (!error) {
          return data ?? [];
        }

        if (isMissingRelationError(error, "user_blocks")) {
          return [];
        }

        throw error;
      };

      const [{ data: liked, error: likedError }, likedBy, blockRows] = await Promise.all([
        supabase.from("likes").select("liked_user_id").eq("user_id", currentUserId).limit(MAX_RELATIONSHIP_ROWS),
        loadLikedByRows(),
        loadBlockRows(),
      ]);

      if (likedError) {
        throw likedError;
      }

      const blockedUserIds = new Set<string>();
      (blockRows ?? []).forEach((row: { blocker_id: string; blocked_id: string }) => {
        if (row.blocker_id === currentUserId) {
          blockedUserIds.add(row.blocked_id);
        }
        if (row.blocked_id === currentUserId) {
          blockedUserIds.add(row.blocker_id);
        }
      });

      return c.json({
        liked:
          liked
            ?.map((item: { liked_user_id: string }) => item.liked_user_id)
            .filter((userId: string) => !blockedUserIds.has(userId)) ?? [],
        likedBy:
          likedBy
            ?.map((item: { user_id: string }) => item.user_id)
            .filter((userId: string) => !blockedUserIds.has(userId)) ?? [],
      });
    } catch (error) {
      console.error("Get likes error:", error);
      return c.json({ error: "Beğeni listesi yüklenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/discovery/likes", authMiddleware, async (c) => {
      try {
        const currentUserId = c.get("userId");
        const supabase = getSupabase();

        const [blockedUserIds, likeSets, matchedUserIds] = await Promise.all([
          fetchBlockedUserIdsForUser(supabase, currentUserId),
          fetchLikeSets(supabase, currentUserId),
          fetchActiveMatchedUserIdsForUser(supabase, currentUserId),
        ]);
        const reconciledMatchedUserIds = await reconcileMutualLikesForUser(
          supabase,
          currentUserId,
          likeSets,
          "like",
        );
        reconciledMatchedUserIds.forEach((userId) => matchedUserIds.add(userId));
        const likedUserIds = [...likeSets.likedIds].filter(
          (userId) => !blockedUserIds.has(userId) && !matchedUserIds.has(userId),
        );
        const likedByUserIds = [...likeSets.likedByIds].filter(
          (userId) => !blockedUserIds.has(userId) && !matchedUserIds.has(userId),
        );
      const incomingLikesUnlocked = await userHasIncomingLikesEntitlement(supabase, currentUserId);
      const payloadMap = await loadUserPayloadMap(
        supabase,
        [...new Set([...likedUserIds, ...(incomingLikesUnlocked ? likedByUserIds : [])])],
      );

      return c.json({
        likedUsers: likedUserIds
          .map((userId) => payloadMap.get(userId))
          .filter((user): user is DatabaseRow => user != null),
        likedByUsers: incomingLikesUnlocked
          ? likedByUserIds
              .map((userId) => payloadMap.get(userId))
              .filter((user): user is DatabaseRow => user != null)
          : [],
        likedByUserIds: incomingLikesUnlocked ? likedByUserIds : [],
        likedByCount: likedByUserIds.length,
        likedByLocked: !incomingLikesUnlocked,
      });
    } catch (error) {
      console.error("Likes discovery error:", error);
      return c.json({ error: "Beğeniler yüklenemedi." }, 500);
    }
  });
};
