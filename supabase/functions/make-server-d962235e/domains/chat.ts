import {
  DEFAULT_CHAT_DIRECTORY_PAGE_SIZE,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CHAT_THREAD_PAGE_SIZE,
  MATCH_SELECT,
  MAX_CHAT_DIRECTORY_PAGE_SIZE,
  MAX_CHAT_MUTATIONS_PER_MINUTE,
  MAX_CHAT_THREAD_PAGE_SIZE,
  MAX_MESSAGES_PER_MINUTE,
  MESSAGE_SELECT,
  app,
  authMiddleware,
  buildAbuseKey,
  buildChatNotificationTag,
  buildFallbackUserPayload,
  buildGroupedMessageNotificationBody,
  buildMatchContextSnapshot,
  buildMessageNotificationBody,
  decodeChatDirectoryCursor,
  decodeMessageCursor,
  dispatchNotificationEvents,
  encodeChatDirectoryCursor,
  encodeMessageCursor,
  enforceRateLimit,
  fetchBlockRows,
  fetchMatchBetweenUsers,
  getChatState,
  getChatVisibleSince,
  getMatchChatDeletedAt,
  getPairKey,
  getPathParam,
  getRequestRateLimitIdentity,
  getSupabase,
  hashIdempotencyPayload,
  isMissingFunctionError,
  isTimestampBefore,
  loadChatDirectoryPageFallback,
  loadChatMessageStats,
  loadChatSettingsMap,
  loadLikeTimelineMap,
  loadPeerChatSettingsMap,
  loadUnreadMessageNotificationLines,
  loadUserPayloadMap,
  markChatNotificationEventsRead,
  queuePairStateEvents,
  queueUserEvents,
  runAfterResponse,
  serializeChatSettings,
  validateMessageText,
} from "../runtime.ts";
import { redactPeerReadReceipts } from "./privacy.ts";

export const CHAT_ROUTES = [
  { method: "POST", path: "/make-server-d962235e/chats/:userId/hide", domain: "chat" },
  { method: "POST", path: "/make-server-d962235e/chats/:userId/delete", domain: "chat" },
  { method: "PUT", path: "/make-server-d962235e/chats/:userId/settings", domain: "chat" },
  { method: "GET", path: "/make-server-d962235e/messages/:userId", domain: "chat" },
  { method: "POST", path: "/make-server-d962235e/messages/:userId", domain: "chat" },
  { method: "PUT", path: "/make-server-d962235e/messages/thread/:userId/read", domain: "chat" },
  { method: "PUT", path: "/make-server-d962235e/messages/:messageId/read", domain: "chat" },
  { method: "GET", path: "/make-server-d962235e/chats", domain: "chat" },
] as const;

export const registerChatRoutes = () => {
  app.post("/make-server-d962235e/chats/:userId/hide", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const otherUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      if (!otherUserId || otherUserId === currentUserId) {
        return c.json({ error: "Geçersiz sohbet isteği." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "hide_chat",
        key: buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const { error } = await supabase
        .from("hidden_chats")
        .upsert({ user_id: currentUserId, other_user_id: otherUserId });

      if (error) {
        console.error("Hide chat error:", error);
        return c.json({ error: "Sohbet güncellenemedi." }, 400);
      }

      queueUserEvents(supabase, [currentUserId], "chat_changed", { reason: "chat_hidden" });
      return c.json({ success: true });
    } catch (error) {
      console.error("Hide chat error:", error);
      return c.json({ error: "Sohbet güncellenemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/chats/:userId/delete", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const otherUserId = getPathParam(c, "userId");
      const supabase = getSupabase();
      const body = await c.req.json().catch(() => ({}));
      const mode =
        body?.mode === "block" || body?.mode === "end"
          ? body.mode
          : "end";

      if (!otherUserId || otherUserId === currentUserId) {
        return c.json({ error: "Geçersiz sohbet silme isteği." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "delete_chat",
        key: buildAbuseKey([currentUserId, otherUserId, getRequestRateLimitIdentity(c), mode]),
        limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const { data: deletionRows, error: deletionError } = await supabase.rpc(
        "delete_chat_for_user_atomic",
        {
          p_actor_user_id: currentUserId,
          p_target_user_id: otherUserId,
          p_mode: mode,
        },
      );

      if (deletionError) {
        console.error("Atomic chat deletion error:", deletionError);
        return c.json({ error: "Sohbet silinemedi." }, 400);
      }

      const deletionResult = Array.isArray(deletionRows) ? deletionRows[0] : deletionRows;
      if (!deletionResult) {
        return c.json({ error: "Sohbet silme işlemi doğrulanamadı." }, 500);
      }

      const deletedForEveryone = deletionResult.deleted_for_everyone === true;
      queuePairStateEvents(
        supabase,
        currentUserId,
        otherUserId,
        deletedForEveryone ? "chat_deleted_for_everyone" : "chat_deleted",
      );
      return c.json({
        success: true,
        deletedForSelf: deletionResult.deleted_for_self === true,
        deletedForEveryone,
      });
    } catch (error) {
      console.error("Delete chat error:", error);
      return c.json({ error: "Sohbet silinemedi." }, 500);
    }
  });

  app.put("/make-server-d962235e/chats/:userId/settings", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const otherUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      if (!otherUserId || otherUserId === currentUserId) {
        return c.json({ error: "Geçersiz sohbet ayarı isteği." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "update_chat_settings",
        key: buildAbuseKey([currentUserId, otherUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const body = await c.req.json().catch(() => ({}));
      const nextSettings = serializeChatSettings({
        read_receipts_enabled: body?.settings?.readReceipts,
        online_status_enabled: body?.settings?.onlineStatus,
        typing_indicator_enabled: body?.settings?.typingIndicator,
        notifications_enabled: body?.settings?.notifications,
      });

      const { error } = await supabase.from("chat_settings").upsert({
        owner_user_id: currentUserId,
        other_user_id: otherUserId,
        read_receipts_enabled: nextSettings.readReceipts,
        online_status_enabled: nextSettings.onlineStatus,
        typing_indicator_enabled: nextSettings.typingIndicator,
        notifications_enabled: nextSettings.notifications,
      });

      if (error) {
        console.error("Update chat settings error:", error);
        return c.json({ error: "Sohbet ayarları güncellenemedi." }, 400);
      }

      queueUserEvents(supabase, [currentUserId, otherUserId], "chat_changed", {
        reason: "chat_settings",
      });
      return c.json({ settings: nextSettings });
    } catch (error) {
      console.error("Update chat settings error:", error);
      return c.json({ error: "Sohbet ayarları güncellenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/messages/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const otherUserId = getPathParam(c, "userId");
      const supabase = getSupabase();
      const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_CHAT_THREAD_PAGE_SIZE);
      const pageSize = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_CHAT_THREAD_PAGE_SIZE)
        : DEFAULT_CHAT_THREAD_PAGE_SIZE;
      const tupleCursor = decodeMessageCursor(c.req.query("cursor"));
      const legacyBeforeCursor = c.req.query("before");

      const match = await fetchMatchBetweenUsers(supabase, currentUserId, otherUserId);
      const visibleSince = getChatVisibleSince(match, currentUserId);
      const deletedChatAt = getMatchChatDeletedAt(match, currentUserId);
      if (deletedChatAt) {
        return c.json({ error: "Sohbet bulunamadı." }, 404);
      }

      const [
        blockRows,
        userMap,
        likeTimelineMap,
        ownSettingsMap,
        peerSettingsMap,
        { data: messages, error: messagesError },
      ] = await Promise.all([
        fetchBlockRows(supabase, currentUserId, otherUserId),
        loadUserPayloadMap(supabase, [otherUserId]),
        loadLikeTimelineMap(supabase, [{ user1Id: currentUserId, user2Id: otherUserId }]),
        loadChatSettingsMap(supabase, currentUserId, [otherUserId]),
        loadChatSettingsMap(supabase, otherUserId, [currentUserId]),
        (() => {
          let query = supabase
            .from("messages")
            .select(MESSAGE_SELECT)
            .or(
              `and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`,
            )
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(pageSize + 1);

          if (visibleSince) {
            query = query.gte("created_at", visibleSince);
          }

          if (tupleCursor) {
            query = query.or(
              `created_at.lt.${tupleCursor.createdAt},and(created_at.eq.${tupleCursor.createdAt},id.lt.${tupleCursor.id})`,
            );
          } else if (legacyBeforeCursor && Number.isFinite(new Date(legacyBeforeCursor).getTime())) {
            query = query.lt("created_at", legacyBeforeCursor);
          }

          return query;
        })(),
      ]);

      if (messagesError) {
        console.error("Get messages error:", messagesError);
        return c.json({ error: "Mesajlar yüklenemedi." }, 500);
      }

      const fetchedMessages = messages ?? [];
      if (!match && fetchedMessages.length === 0) {
        return c.json({ error: "Sohbet bulunamadı." }, 404);
      }

      const hasMoreMessages = fetchedMessages.length > pageSize;
      const visibleMessages = fetchedMessages
        .slice(0, pageSize)
        .filter((message: { created_at?: string | null }) =>
          !isTimestampBefore(message.created_at ?? null, visibleSince),
        )
        .sort((left: { created_at?: string | null; id?: string | null }, right: { created_at?: string | null; id?: string | null }) =>
          new Date(left.created_at ?? "").getTime() - new Date(right.created_at ?? "").getTime() ||
          String(left.id ?? "").localeCompare(String(right.id ?? "")),
        );
      const chatState = getChatState(match, currentUserId, otherUserId, blockRows);
      const user = userMap.get(otherUserId) ?? buildFallbackUserPayload(otherUserId);
      const likeTimeline = likeTimelineMap.get(getPairKey(currentUserId, otherUserId)) ?? null;
      const peerSettings = peerSettingsMap.get(currentUserId) ?? { ...DEFAULT_CHAT_SETTINGS };
      const responseMessages = redactPeerReadReceipts(
        visibleMessages,
        currentUserId,
        peerSettings.readReceipts,
      );
      const lastMessageTime =
        visibleMessages.at(-1)?.created_at ?? visibleSince ?? match?.created_at ?? match?.updated_at ?? new Date().toISOString();
      const matchCreatedAtMs = new Date(match?.created_at ?? "").getTime();
      const hasConversationActivity = Boolean(
        visibleMessages.length &&
          (!match ||
            !Number.isFinite(matchCreatedAtMs) ||
            new Date(lastMessageTime).getTime() >= matchCreatedAtMs),
      );

      return c.json({
        messages: responseMessages,
        pageInfo: {
          hasMore: hasMoreMessages,
          nextCursor: encodeMessageCursor(visibleMessages[0] ?? {}),
        },
        chat: {
          userId: otherUserId,
          user,
          lastMessage: visibleMessages.at(-1)?.text ?? "",
          lastMessageTime,
          hasConversationActivity,
          unread: Boolean(
            visibleMessages.some(
              (message) =>
                message.sender_id === otherUserId &&
                message.receiver_id === currentUserId &&
                !message.read,
            ),
          ),
          matchContext: buildMatchContextSnapshot(match, likeTimeline, currentUserId),
          settings: ownSettingsMap.get(otherUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
          peerSettings,
          ...chatState,
        },
      });
    } catch (error) {
      console.error("Get messages error:", error);
      return c.json({ error: "Mesajlar yüklenemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/messages/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const receiverId = getPathParam(c, "userId");
      const { text, clientMessageId } = await c.req.json();
      const supabase = getSupabase();

      const normalizedText = typeof text === "string" ? text.trim() : "";
      const normalizedClientMessageId =
        typeof clientMessageId === "string" && /^[\w:.-]{8,120}$/.test(clientMessageId.trim())
          ? clientMessageId.trim()
          : null;
      const clientPayloadHash = normalizedClientMessageId
        ? await hashIdempotencyPayload(`${receiverId}:${normalizedText}`)
        : null;
      const messageValidationMessage = validateMessageText(normalizedText);
      if (messageValidationMessage) {
        return c.json({ error: messageValidationMessage }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "send_message",
        key: buildAbuseKey([currentUserId, receiverId, getRequestRateLimitIdentity(c)]),
        limit: MAX_MESSAGES_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok hızlı mesaj gönderiyorsun. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      const { data: messageRows, error: messageError } = await supabase.rpc(
        "send_chat_message_atomic",
        {
          p_sender_user_id: currentUserId,
          p_receiver_user_id: receiverId,
          p_text: normalizedText,
          p_client_message_id: normalizedClientMessageId,
          p_client_payload_hash: clientPayloadHash,
        },
      );

      if (messageError) {
        console.error("Atomic send message error:", messageError);
        return c.json({ error: "Mesaj gönderilemedi." }, 500);
      }

      const messageResult = Array.isArray(messageRows)
        ? messageRows[0]
        : messageRows;

      if (!messageResult) {
        return c.json({ error: "Mesaj gönderilemedi." }, 500);
      }

      if (messageResult.outcome === "idempotency_conflict") {
        return c.json({
          error: "Client message ID was already used for different content.",
        }, 409);
      }

      if (
        messageResult.outcome === "missing_match" ||
        messageResult.outcome === "relationship_locked"
      ) {
        return c.json({ error: "Bu kullanıcıya mesaj gönderemezsin." }, 403);
      }

      if (messageResult.outcome !== "sent" && messageResult.outcome !== "replayed") {
        return c.json({ error: "Mesaj isteği geçersiz." }, 400);
      }

      if (
        !messageResult.message_id ||
        !messageResult.sender_id ||
        !messageResult.receiver_id ||
        !messageResult.message_text ||
        !messageResult.message_created_at
      ) {
        console.error("Atomic send message returned an incomplete row:", messageResult.outcome);
        return c.json({ error: "Mesaj gönderilemedi." }, 500);
      }

      const message = {
        id: messageResult.message_id,
        sender_id: messageResult.sender_id,
        receiver_id: messageResult.receiver_id,
        text: messageResult.message_text,
        read: Boolean(messageResult.message_read),
        created_at: messageResult.message_created_at,
        client_request_id: messageResult.client_request_id,
        client_message_id: messageResult.client_message_id,
      };
      const receiverDeletedChatAt = messageResult.receiver_chat_deleted_at;
      const idempotencyReplayed = messageResult.idempotency_replayed;

      if (idempotencyReplayed) {
        return c.json({ message, idempotencyReplayed: true });
      }

      const messageNotificationTask = (async () => {
        if (receiverDeletedChatAt) {
          return;
        }

        const [senderMap, receiverSettingsMap, unreadMessageGroup] = await Promise.all([
          loadUserPayloadMap(supabase, [currentUserId]),
          loadChatSettingsMap(supabase, receiverId, [currentUserId]),
          loadUnreadMessageNotificationLines(supabase, receiverId, currentUserId),
        ]);
        const sender = senderMap.get(currentUserId);
        const receiverSettings = receiverSettingsMap.get(currentUserId) ?? { ...DEFAULT_CHAT_SETTINGS };
        const messagePreview = buildMessageNotificationBody(normalizedText);
        const nextLines = unreadMessageGroup.lines.length > 0 ? unreadMessageGroup.lines : [messagePreview];
        const groupedMessageCount = Math.max(unreadMessageGroup.totalCount, nextLines.length);
        const senderName =
          typeof sender?.name === "string" && sender.name.trim().length > 0
            ? sender.name.trim()
            : "Yeni mesaj";
        const notificationTag = buildChatNotificationTag(receiverId, currentUserId);
        const collapseId = notificationTag;

        if (receiverSettings.notifications) {
          await dispatchNotificationEvents(supabase, [
            {
              userId: receiverId,
              title: senderName,
              body: buildGroupedMessageNotificationBody(nextLines, groupedMessageCount),
              actorUserId: currentUserId,
              kind: "message",
              routeKind: "chat",
              routeUserId: currentUserId,
              payload: {
                messagePreview,
                senderName,
                notificationTag,
                collapseId,
                groupedMessageCount,
              },
            },
          ], { deferPush: true });
        }
      })().catch((notificationError) => {
        console.error("Send push notification error:", notificationError);
      });

      if (!runAfterResponse(messageNotificationTask)) {
        void messageNotificationTask;
      }

      queueUserEvents(supabase, [currentUserId, receiverId], "chat_changed", {
        reason: "message_sent",
        message,
      });
      return c.json({ message, idempotencyReplayed: false });
    } catch (error) {
      console.error("Send message error:", error);
      return c.json({ error: "Mesaj gönderilemedi." }, 500);
    }
  });

  app.put("/make-server-d962235e/messages/thread/:userId/read", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const otherUserId = getPathParam(c, "userId");
      const supabase = getSupabase();

      const { error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("sender_id", otherUserId)
        .eq("receiver_id", currentUserId)
        .eq("read", false);

      if (error) {
        console.error("Mark thread read error:", error);
        return c.json({ error: "Sohbet okundu olarak işaretlenemedi." }, 400);
      }

      await markChatNotificationEventsRead(supabase, currentUserId, otherUserId);

      queueUserEvents(supabase, [currentUserId, otherUserId], "chat_changed", { reason: "thread_read" });
      return c.json({ success: true });
    } catch (error) {
      console.error("Mark thread read error:", error);
      return c.json({ error: "Sohbet okundu olarak işaretlenemedi." }, 500);
    }
  });

  app.put("/make-server-d962235e/messages/:messageId/read", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const messageId = getPathParam(c, "messageId");
      const supabase = getSupabase();

      const { data: readMessage, error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("id", messageId)
        .eq("receiver_id", currentUserId)
        .select("sender_id")
        .maybeSingle();

      if (error) {
        console.error("Mark read error:", error);
        return c.json({ error: "Mesaj okundu olarak işaretlenemedi." }, 400);
      }

      if (readMessage?.sender_id) {
        queueUserEvents(supabase, [currentUserId, readMessage.sender_id], "chat_changed", {
          reason: "message_read",
        });
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("Mark read error:", error);
      return c.json({ error: "Mesaj okundu olarak işaretlenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/chats", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_CHAT_DIRECTORY_PAGE_SIZE);
      const pageSize = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_CHAT_DIRECTORY_PAGE_SIZE)
        : DEFAULT_CHAT_DIRECTORY_PAGE_SIZE;
      const rawCursor = c.req.query("cursor");
      const cursor = decodeChatDirectoryCursor(rawCursor);

      if (rawCursor && !cursor) {
        return c.json({ error: "Sohbet listesi sayfa isteği geçersiz." }, 400);
      }

      let { data: directoryData, error: directoryError } = await supabase.rpc("get_chat_directory_page", {
        p_current_user_id: currentUserId,
        p_cursor_time: cursor?.activityAt,
        p_cursor_user_id: cursor?.userId,
        p_limit: pageSize + 1,
      });

      if (directoryError) {
        if (!isMissingFunctionError(directoryError, "get_chat_directory_page")) {
          console.error("Get chat directory error:", directoryError);
        return c.json({ error: "Sohbetler yüklenemedi." }, 500);
        }

        directoryData = await loadChatDirectoryPageFallback(
          supabase,
          currentUserId,
          cursor,
          pageSize,
        );
        directoryError = null;
      }

      const directoryRows = (directoryData ?? []) as Array<{
        other_user_id: string;
        activity_at: string;
      }>;
      const visibleDirectoryRows = directoryRows.slice(0, pageSize);
      const hasMore = directoryRows.length > pageSize;

      if (visibleDirectoryRows.length === 0) {
        return c.json({
          chats: [],
          pageInfo: { hasMore: false, nextCursor: null },
        });
      }

      const otherUserIds = visibleDirectoryRows.map((row) => row.other_user_id);
      const [user1MatchesResult, user2MatchesResult, blockedByMeResult, blockedByOtherResult] = await Promise.all([
        supabase
          .from("matches")
          .select(MATCH_SELECT)
          .eq("user1_id", currentUserId)
          .in("user2_id", otherUserIds)
          .limit(otherUserIds.length),
        supabase
          .from("matches")
          .select(MATCH_SELECT)
          .eq("user2_id", currentUserId)
          .in("user1_id", otherUserIds)
          .limit(otherUserIds.length),
        supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .eq("blocker_id", currentUserId)
          .in("blocked_id", otherUserIds)
          .limit(otherUserIds.length),
        supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .eq("blocked_id", currentUserId)
          .in("blocker_id", otherUserIds)
          .limit(otherUserIds.length),
      ]);

      const relatedError =
        user1MatchesResult.error ??
        user2MatchesResult.error ??
        blockedByMeResult.error ??
        blockedByOtherResult.error;

      if (relatedError) {
        console.error("Get chat relationships error:", relatedError);
        return c.json({ error: "Sohbetler yüklenemedi." }, 500);
      }

      const visibleMatches = [
        ...(user1MatchesResult.data ?? []),
        ...(user2MatchesResult.data ?? []),
      ];
      const matchMap = new Map(
        visibleMatches.map((match) => [
          match.user1_id === currentUserId ? match.user2_id : match.user1_id,
          match,
        ]),
      );
      const safeBlockRows = [
        ...(blockedByMeResult.data ?? []),
        ...(blockedByOtherResult.data ?? []),
      ] as Array<{ blocker_id: string; blocked_id: string }>;
      const chatPairs = visibleDirectoryRows.map((row) => ({
        otherUserId: row.other_user_id,
        activityAt: row.activity_at,
        match: matchMap.get(row.other_user_id) ?? null,
      }));
      const visibleSinceMap = new Map(
        chatPairs.map((pair) => [
          pair.otherUserId,
          getChatVisibleSince(pair.match, currentUserId),
        ]),
      );

      const [userMap, likeTimelineMap, messageStatsMap, ownSettingsMap, peerSettingsMap] = await Promise.all([
        loadUserPayloadMap(supabase, otherUserIds),
        loadLikeTimelineMap(
          supabase,
          visibleMatches.map((match) => ({
            user1Id: match.user1_id,
            user2Id: match.user2_id,
          })),
        ),
        loadChatMessageStats(supabase, currentUserId, otherUserIds, visibleSinceMap),
        loadChatSettingsMap(supabase, currentUserId, otherUserIds),
        loadPeerChatSettingsMap(supabase, currentUserId, otherUserIds),
      ]);

      const chats = chatPairs.map(({ otherUserId, activityAt, match }) => {
        const likeTimeline = match
          ? likeTimelineMap.get(getPairKey(match.user1_id, match.user2_id)) ?? null
          : null;
        const pairBlockRows = safeBlockRows.filter(
          (row: { blocker_id: string; blocked_id: string }) =>
            (row.blocker_id === currentUserId && row.blocked_id === otherUserId) ||
            (row.blocker_id === otherUserId && row.blocked_id === currentUserId),
        );
        const messageStats = messageStatsMap.get(otherUserId);
        const matchCreatedAtMs = new Date(match?.created_at ?? "").getTime();
        const hasConversationActivity = Boolean(
          messageStats?.lastMessageTime &&
            (!match ||
              !Number.isFinite(matchCreatedAtMs) ||
              new Date(messageStats.lastMessageTime).getTime() >= matchCreatedAtMs),
        );

        return {
          userId: otherUserId,
          user: userMap.get(otherUserId) ?? buildFallbackUserPayload(otherUserId),
          lastMessage: messageStats?.lastMessage ?? "",
          lastMessageTime:
            messageStats?.lastMessageTime ??
            visibleSinceMap.get(otherUserId) ??
            match?.created_at ??
            match?.updated_at ??
            activityAt,
          hasConversationActivity,
          unread: (messageStats?.unreadCount ?? 0) > 0,
          matchContext: buildMatchContextSnapshot(match, likeTimeline, currentUserId),
          settings: ownSettingsMap.get(otherUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
          peerSettings: peerSettingsMap.get(otherUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
          ...getChatState(match, currentUserId, otherUserId, pairBlockRows),
        };
      });

      chats.sort(
        (left, right) =>
          new Date(right.lastMessageTime).getTime() - new Date(left.lastMessageTime).getTime(),
      );

      return c.json({
        chats,
        pageInfo: {
          hasMore,
          nextCursor: hasMore
            ? encodeChatDirectoryCursor(visibleDirectoryRows.at(-1) ?? {})
            : null,
        },
      });
    } catch (error) {
      console.error("Get chats error:", error);
      return c.json({ error: "Sohbetler yüklenemedi." }, 500);
    }
  });
};
