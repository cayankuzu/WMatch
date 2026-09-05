import {
  app,
  authMiddleware,
  buildAbuseKey,
  buildAuthUserMetadata,
  buildUserPayload,
  cleanupRemovedManagedProfilePhotos,
  cleanupStaleProfilePhotoQuarantine,
  decodeCompatibilityCursor,
  decodeLiveNowCursor,
  DEFAULT_COMPATIBILITY_PAGE_SIZE,
  DEFAULT_DISCOVERY_PREFERENCES,
  DEFAULT_WATCH_DISCOVERY_PAGE_SIZE,
  encodeCompatibilityCursor,
  encodeLiveNowCursor,
  enforceRateLimit,
  fetchBlockRows,
  finalizeValidatedProfilePhotos,
  findProfileByUsername,
  getErrorMessage,
  getPathParam,
  getProfileCoordinates,
  getRequestRateLimitIdentity,
  getSupabase,
  getUsernameValidationMessage,
  hasActiveDistanceFilter,
  isMediaType,
  isMissingProfileColumnError,
  LIVE_NOW_PAGE_SIZE,
  loadDiscoveryPreferencesMap,
  loadPrivateProfileLocationMap,
  loadUserPayloadMap,
  MAX_COMPATIBILITY_PAGE_SIZE,
  MAX_CURRENTLY_WATCHING_MUTATIONS_PER_MINUTE,
  MAX_FAVORITES_COUNT,
  MAX_PROFILE_UPDATES_PER_MINUTE,
  MAX_WATCH_DISCOVERY_PAGE_SIZE,
  MAX_WATCHED_COUNT,
  normalizeBio,
  normalizeDiscoveryPreferences,
  normalizeMediaType,
  normalizeUsername,
  normalizeWhitespace,
  ProfilePhotoValidationError,
  PUBLIC_PROFILE_SELECT,
  queueUserEvents,
  queueWatchSessionDiscoveryEvents,
  sanitizeMediaRefList,
  sanitizeMovieIdList,
  SERVER_PROFILE_SELECT,
  signProfilePhotosForPayloads,
  upsertPrivateProfileLocation,
  validateAge,
  validateAndStageOwnedProfilePhotos,
  validateBio,
  validateCoordinate,
  validateDiscoveryPreferences,
  validateDisplayName,
  validateGender,
  validateLetterboxd,
  validateMovieCollectionPayload,
  WATCH_SESSION_DURATION_MS,
} from "../runtime.ts";
import type { DatabaseRow, MediaType, TablesUpdate } from "../runtime.ts";

export const PROFILE_DISCOVERY_ROUTES = [
  {
    method: "GET",
    path: "/make-server-d962235e/profile/:userId",
    domain: "profileDiscovery",
  },
  {
    method: "PUT",
    path: "/make-server-d962235e/profile",
    domain: "profileDiscovery",
  },
  {
    method: "GET",
    path: "/make-server-d962235e/watch/live-now",
    domain: "profileDiscovery",
  },
  {
    method: "GET",
    path: "/make-server-d962235e/users",
    domain: "profileDiscovery",
  },
  {
    method: "GET",
    path: "/make-server-d962235e/discovery/watch",
    domain: "profileDiscovery",
  },
  {
    method: "GET",
    path: "/make-server-d962235e/discovery/compatibility",
    domain: "profileDiscovery",
  },
] as const;

export const registerProfileDiscoveryRoutes = () => {
  app.get(
    "/make-server-d962235e/profile/:userId",
    authMiddleware,
    async (c) => {
      try {
        const currentUserId = c.get("userId");
        const userId = getPathParam(c, "userId");
        const supabase = getSupabase();

        if (currentUserId !== userId) {
          const blockRows = await fetchBlockRows(
            supabase,
            currentUserId,
            userId,
          );
          if (blockRows.length > 0) {
            return c.json({ error: "Bu profile erişemiyorsun." }, 403);
          }
        }

        const payloadMap = await loadUserPayloadMap(
          supabase,
          [userId],
          currentUserId,
        );
        const profile = payloadMap.get(userId);

        if (!profile) {
          console.error(
            "Profile fetch error:",
            "Profile payload could not be loaded.",
          );
          return c.json({ error: "Profil bulunamadı." }, 404);
        }

        return c.json(profile);
      } catch (error) {
        console.error("Get profile error:", error);
        return c.json({ error: "Profil yüklenemedi." }, 500);
      }
    },
  );

  app.put("/make-server-d962235e/profile", authMiddleware, async (c) => {
    try {
      const userId = c.get("userId");
      const {
        name,
        age,
        username,
        bio,
        letterboxd,
        photos,
        favoriteMovies,
        favoriteMedia,
        watchedMovies,
        watchedMedia,
        currentlyWatching,
        currentlyWatchingMediaType,
        currentlyWatchingAction,
        currentlyWatchingVersion,
        showAgeOnProfile,
        gender,
        showGenderOnProfile,
        latitude,
        longitude,
        locationUpdatedAt,
        discoveryPreferences,
      } = await c.req.json();

      const supabase = getSupabase();
      await cleanupStaleProfilePhotoQuarantine(supabase, userId);
      const requestedWatchingMutation = currentlyWatching !== undefined ||
        currentlyWatchingAction !== undefined;
      const rateLimit = await enforceRateLimit(supabase, {
        action: requestedWatchingMutation
          ? "profile_watch_update"
          : "profile_update",
        key: buildAbuseKey([userId, getRequestRateLimitIdentity(c)]),
        limit: requestedWatchingMutation
          ? MAX_CURRENTLY_WATCHING_MUTATIONS_PER_MINUTE
          : MAX_PROFILE_UPDATES_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({
          error:
            "Çok hızlı güncelleme yapıyorsun. Lütfen biraz bekleyip tekrar dene.",
        }, 429);
      }

      const { data: rawCurrentProfile, error: currentProfileError } =
        await supabase
          .from("profiles")
          .select(SERVER_PROFILE_SELECT)
          .eq("id", userId)
          .single();

      if (currentProfileError || !rawCurrentProfile) {
        return c.json({ error: "Profil bulunamadı." }, 404);
      }

      const privateLocationMap = await loadPrivateProfileLocationMap(supabase, [
        userId,
      ]);
      const currentProfile = {
        ...rawCurrentProfile,
        ...(privateLocationMap.get(userId) ?? {}),
      };

      const requestedDiscoveryPreferences =
        discoveryPreferences && typeof discoveryPreferences === "object"
          ? normalizeDiscoveryPreferences(discoveryPreferences)
          : null;
      const discoveryValidationMessage = validateDiscoveryPreferences(
        requestedDiscoveryPreferences,
      );
      const normalizedFavoriteMovies = sanitizeMovieIdList(
        favoriteMovies,
        MAX_FAVORITES_COUNT,
      );
      const normalizedWatchedMovies = sanitizeMovieIdList(
        watchedMovies,
        MAX_WATCHED_COUNT,
      );
      const normalizedFavoriteMedia = sanitizeMediaRefList(
        favoriteMedia,
        normalizedFavoriteMovies,
        MAX_FAVORITES_COUNT,
      );
      const normalizedWatchedMedia = sanitizeMediaRefList(
        watchedMedia,
        normalizedWatchedMovies,
        MAX_WATCHED_COUNT,
      );
      const normalizedCurrentlyWatchingMediaType = normalizeMediaType(
        currentlyWatchingMediaType,
      );
      const movieValidationMessage = validateMovieCollectionPayload(
        normalizedFavoriteMedia.map((item) => item.id),
        normalizedWatchedMedia.map((item) => item.id),
      );

      if (discoveryValidationMessage) {
        return c.json({ error: discoveryValidationMessage }, 400);
      }

      if (movieValidationMessage) {
        return c.json({ error: movieValidationMessage }, 400);
      }

      if (
        currentlyWatching !== undefined &&
        currentlyWatching !== null &&
        currentlyWatchingMediaType !== undefined &&
        !isMediaType(currentlyWatchingMediaType)
      ) {
        return c.json({ error: "Geçersiz medya tipi." }, 400);
      }

      if (
        currentlyWatchingAction !== undefined &&
        currentlyWatchingAction !== "start" &&
        currentlyWatchingAction !== "pause" &&
        currentlyWatchingAction !== "resume" &&
        currentlyWatchingAction !== "stop"
      ) {
        return c.json({ error: "Geçersiz izleme aksiyonu." }, 400);
      }

      let previousWatchingForEvents: {
        movie_id: number;
        media_type?: string | null;
        state?: string | null;
        expires_at?: string | null;
      } | null = null;

      if (requestedWatchingMutation) {
        const { data: previousWatching, error: previousWatchingError } =
          await supabase
            .from("currently_watching")
            .select("movie_id, media_type, state, expires_at")
            .eq("user_id", userId)
            .maybeSingle();

        if (previousWatchingError) {
          console.error(
            "Previous watch state lookup error:",
            previousWatchingError,
          );
        } else {
          previousWatchingForEvents = previousWatching ?? null;
        }
      }

      const profileUpdates: TablesUpdate<"profiles"> = {};
      let privateLocationUpdate: {
        latitude: number | null;
        longitude: number | null;
        location_updated_at: string | null;
      } | null = null;

      if (typeof name === "string") {
        const normalizedName = normalizeWhitespace(name);
        const nameValidationMessage = validateDisplayName(normalizedName);
        if (nameValidationMessage) {
          return c.json({ error: nameValidationMessage }, 400);
        }

        profileUpdates.name = normalizedName;
      }

      if (typeof age === "number" && Number.isFinite(age)) {
        const ageValidationMessage = validateAge(age);
        if (ageValidationMessage) {
          return c.json({ error: ageValidationMessage }, 400);
        }

        profileUpdates.age = age;
      }

      if (gender !== undefined) {
        const genderValidationMessage = validateGender(gender);
        if (genderValidationMessage) {
          return c.json({ error: genderValidationMessage }, 400);
        }

        profileUpdates.gender = gender;
      }

      if (typeof username === "string") {
        const normalizedUsername = normalizeUsername(username);
        const usernameValidationMessage = getUsernameValidationMessage(
          normalizedUsername,
        );
        if (usernameValidationMessage) {
          return c.json({ error: usernameValidationMessage }, 400);
        }

        if (normalizedUsername !== currentProfile.username) {
          const existingProfile = await findProfileByUsername(
            supabase,
            normalizedUsername,
          );
          if (existingProfile && existingProfile.id !== userId) {
            return c.json(
              { error: "Bu kullanıcı adı zaten kullanılıyor." },
              409,
            );
          }
        }
        profileUpdates.username = normalizedUsername;
      }

      if (typeof bio === "string") {
        const normalizedBioValue = normalizeBio(bio);
        const bioValidationMessage = validateBio(normalizedBioValue);
        if (bioValidationMessage) {
          return c.json({ error: bioValidationMessage }, 400);
        }

        profileUpdates.bio = normalizedBioValue;
      }

      if (typeof letterboxd === "string") {
        const normalizedLetterboxd = normalizeWhitespace(letterboxd);
        const letterboxdValidationMessage = validateLetterboxd(
          normalizedLetterboxd,
        );
        if (letterboxdValidationMessage) {
          return c.json({ error: letterboxdValidationMessage }, 400);
        }

        profileUpdates.letterboxd = normalizedLetterboxd;
      }

      let validatedPhotoMoves: Array<
        { sourcePath: string; finalPath: string }
      > = [];
      if (photos !== undefined) {
        try {
          const validatedPhotos = await validateAndStageOwnedProfilePhotos(
            supabase,
            userId,
            photos,
            currentProfile.photos ?? [],
          );
          profileUpdates.photos = validatedPhotos.photos;
          validatedPhotoMoves = validatedPhotos.pendingMoves;
        } catch (error) {
          if (error instanceof ProfilePhotoValidationError) {
            return c.json({
              error: "Profil fotoğrafı güvenlik doğrulamasından geçemedi.",
            }, 400);
          }

          throw error;
        }
      }

      if (typeof showAgeOnProfile === "boolean") {
        profileUpdates.show_age_on_profile = showAgeOnProfile;
      }

      if (typeof showGenderOnProfile === "boolean") {
        profileUpdates.show_gender_on_profile = showGenderOnProfile;
      }

      if (
        latitude !== undefined || longitude !== undefined ||
        locationUpdatedAt !== undefined
      ) {
        const normalizedLatitude = latitude === null || latitude === undefined
          ? null
          : Number(latitude);
        const normalizedLongitude =
          longitude === null || longitude === undefined
            ? null
            : Number(longitude);
        const latitudeValidationMessage = validateCoordinate(
          normalizedLatitude,
          "latitude",
        );
        const longitudeValidationMessage = validateCoordinate(
          normalizedLongitude,
          "longitude",
        );

        if (latitudeValidationMessage) {
          return c.json({ error: latitudeValidationMessage }, 400);
        }

        if (longitudeValidationMessage) {
          return c.json({ error: longitudeValidationMessage }, 400);
        }

        if ((normalizedLatitude == null) !== (normalizedLongitude == null)) {
          return c.json({
            error:
              "Konum güncellemesinde enlem ve boylam birlikte gönderilmeli.",
          }, 400);
        }

        privateLocationUpdate = {
          latitude: normalizedLatitude,
          longitude: normalizedLongitude,
          location_updated_at:
            normalizedLatitude != null && normalizedLongitude != null
              ? typeof locationUpdatedAt === "string" &&
                  locationUpdatedAt.trim()
                ? locationUpdatedAt
                : new Date().toISOString()
              : null,
        };
      }

      let profile = currentProfile;
      const currentAuthUserMetadata = buildAuthUserMetadata(currentProfile);
      let authMetadataSynced = false;

      if (Object.keys(profileUpdates).length > 0) {
        const nextAuthUserMetadata = buildAuthUserMetadata({
          ...currentProfile,
          ...profileUpdates,
        });
        const { error: authMetadataError } = await supabase.auth.admin
          .updateUserById(userId, {
            user_metadata: nextAuthUserMetadata,
          });

        if (authMetadataError) {
          console.error("Auth metadata update error:", authMetadataError);
          return c.json(
            { error: "Profil doğrulama bilgileri güncellenemedi." },
            500,
          );
        }

        authMetadataSynced = true;

        const applyProfileUpdates = async (updates: TablesUpdate<"profiles">) =>
          supabase.from("profiles").update(updates).eq("id", userId).select(
            PUBLIC_PROFILE_SELECT,
          ).single();

        let { data: updatedProfile, error: profileError } =
          await applyProfileUpdates(profileUpdates);

        if (
          profileError &&
          (("show_age_on_profile" in profileUpdates &&
            isMissingProfileColumnError(profileError, "show_age_on_profile")) ||
            ("show_gender_on_profile" in profileUpdates &&
              isMissingProfileColumnError(
                profileError,
                "show_gender_on_profile",
              )))
        ) {
          const legacyProfileUpdates = { ...profileUpdates };
          delete legacyProfileUpdates.show_age_on_profile;
          delete legacyProfileUpdates.show_gender_on_profile;

          if (Object.keys(legacyProfileUpdates).length === 0) {
            profileError = null;
            updatedProfile = currentProfile;
          } else {
            ({ data: updatedProfile, error: profileError } =
              await applyProfileUpdates(legacyProfileUpdates));
          }
        }

        if (profileError || !updatedProfile) {
          if (authMetadataSynced) {
            const { error: rollbackMetadataError } = await supabase.auth.admin
              .updateUserById(userId, {
                user_metadata: currentAuthUserMetadata,
              });

            if (rollbackMetadataError) {
              console.error(
                "Auth metadata rollback error:",
                rollbackMetadataError,
              );
            }
          }

          console.error("Profile update error:", profileError);
          return c.json({ error: "Profil güncellenemedi." }, 400);
        }

        if (validatedPhotoMoves.length > 0) {
          try {
            await finalizeValidatedProfilePhotos(supabase, validatedPhotoMoves);
          } catch (error) {
            const { error: rollbackProfileError } = await applyProfileUpdates({
              photos: Array.isArray(currentProfile.photos)
                ? currentProfile.photos
                : [],
            });
            const { error: rollbackMetadataError } = await supabase.auth.admin
              .updateUserById(userId, {
                user_metadata: currentAuthUserMetadata,
              });
            if (rollbackProfileError || rollbackMetadataError) {
              console.error("Profile photo finalize rollback error.");
            }
            console.error("Profile photo finalize error:", error);
            return c.json({
              error: "Profil fotoÄŸrafÄ± gÃ¼venli alana taÅŸÄ±namadÄ±.",
            }, 400);
          }
        }

        if (photos !== undefined) {
          await cleanupRemovedManagedProfilePhotos(
            supabase,
            userId,
            currentProfile.photos ?? [],
            updatedProfile.photos ?? [],
          );
        }

        profile = {
          ...updatedProfile,
          latitude: privateLocationMap.get(userId)?.latitude ??
            currentProfile.latitude ?? null,
          longitude: privateLocationMap.get(userId)?.longitude ??
            currentProfile.longitude ?? null,
          location_updated_at:
            privateLocationMap.get(userId)?.location_updated_at ??
              currentProfile.location_updated_at ?? null,
        };
      }

      if (privateLocationUpdate) {
        const privateLocationError = await upsertPrivateProfileLocation(
          supabase,
          userId,
          privateLocationUpdate,
        );

        if (privateLocationError) {
          console.error(
            "Private profile location update error:",
            privateLocationError,
          );
          return c.json({ error: "Konum güncellenemedi." }, 500);
        }

        profile = {
          ...profile,
          ...privateLocationUpdate,
        };
      }

      let nextDiscoveryPreferences = DEFAULT_DISCOVERY_PREFERENCES;

      if (requestedDiscoveryPreferences) {
        const currentCoordinates = getProfileCoordinates(profile);
        const wantsDistanceFilter = hasActiveDistanceFilter(
          requestedDiscoveryPreferences,
        );

        if (wantsDistanceFilter && !currentCoordinates) {
          return c.json({
            error: "Mesafe filtresi için önce konumunu paylaşmalısın.",
          }, 400);
        }

        const { error: preferenceError } = await supabase.from(
          "discovery_preferences",
        ).upsert({
          user_id: userId,
          gender_preference: requestedDiscoveryPreferences.genderPreference,
          age_min: requestedDiscoveryPreferences.ageMin,
          age_max: requestedDiscoveryPreferences.ageMax,
          distance_min_km: requestedDiscoveryPreferences.distanceMinKm,
          distance_max_km: requestedDiscoveryPreferences.distanceMaxKm,
          compatibility_min: requestedDiscoveryPreferences.compatibilityMin,
          compatibility_max: requestedDiscoveryPreferences.compatibilityMax,
        });

        if (preferenceError) {
          console.error("Discovery preferences update error:", preferenceError);
          return c.json({ error: "Keşif tercihleri güncellenemedi." }, 400);
        }

        nextDiscoveryPreferences = requestedDiscoveryPreferences;
      } else {
        const preferenceMap = await loadDiscoveryPreferencesMap(supabase, [
          userId,
        ]);
        nextDiscoveryPreferences = preferenceMap.get(userId) ??
          DEFAULT_DISCOVERY_PREFERENCES;
      }

      if (
        favoriteMovies !== undefined || watchedMovies !== undefined ||
        favoriteMedia !== undefined || watchedMedia !== undefined
      ) {
        const { error: movieSyncError } = await supabase.rpc(
          "replace_user_media_collections",
          {
            p_user_id: userId,
            p_favorites:
              favoriteMovies !== undefined || favoriteMedia !== undefined
                ? normalizedFavoriteMedia
                : null,
            p_watched: watchedMovies !== undefined || watchedMedia !== undefined
              ? normalizedWatchedMedia
              : null,
          },
        );

        if (movieSyncError) {
          console.error("Sync user movies error:", movieSyncError);
          return c.json({ error: "İçerik koleksiyonu güncellenemedi." }, 400);
        }
      }

      if (
        currentlyWatching !== undefined || currentlyWatchingAction !== undefined
      ) {
        const normalizedWatchAction = currentlyWatchingAction ??
          (currentlyWatching === null ? "stop" : "start");

        if (
          (normalizedWatchAction === "start" ||
            normalizedWatchAction === "resume") &&
          currentlyWatching !== undefined &&
          currentlyWatching !== null &&
          (typeof currentlyWatching !== "number" ||
            !Number.isInteger(currentlyWatching) || currentlyWatching <= 0)
        ) {
          return c.json({ error: "Etkin içerik isteği geçersiz." }, 400);
        }

        const { error: watchTransitionError } = await supabase.rpc(
          "apply_watch_session_transition",
          {
            p_user_id: userId,
            p_action: normalizedWatchAction,
            p_movie_id: typeof currentlyWatching === "number"
              ? currentlyWatching
              : undefined,
            p_media_type: currentlyWatchingMediaType !== undefined
              ? normalizedCurrentlyWatchingMediaType
              : undefined,
            p_expected_version: Number.isInteger(currentlyWatchingVersion) &&
                currentlyWatchingVersion > 0
              ? currentlyWatchingVersion
              : undefined,
            p_duration_ms: WATCH_SESSION_DURATION_MS,
          },
        );

        if (watchTransitionError) {
          const message = getErrorMessage(
            watchTransitionError,
            "İzleme durumu güncellenemedi.",
          );
          const isVersionConflict =
            (watchTransitionError as { code?: string }).code === "40001" ||
            message.toLowerCase().includes("watch_version_conflict");

          console.error("Apply watch transition error:", watchTransitionError);

          if (isVersionConflict) {
            const { data: conflictWatching } = await supabase
              .from("currently_watching")
              .select("movie_id, media_type, state, version, updated_at")
              .eq("user_id", userId)
              .maybeSingle();

            return c.json({
              error:
                "İzleme durumu başka bir cihazda değişti. Lütfen yenileyip tekrar dene.",
              conflict: conflictWatching
                ? {
                  movieId: conflictWatching.movie_id,
                  mediaType: conflictWatching.media_type,
                  state: conflictWatching.state,
                  version: conflictWatching.version,
                  updatedAt: conflictWatching.updated_at,
                }
                : {
                  movieId: null,
                  mediaType: null,
                  state: "idle",
                  version: null,
                  updatedAt: null,
                },
            }, 409);
          }

          return c.json(
            { error: "İzleme durumu güncellenemedi." },
            400,
          );
        }
      }

      const { data: movies, error: moviesError } = await supabase
        .from("user_movies")
        .select("movie_id, media_type, type")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_FAVORITES_COUNT + MAX_WATCHED_COUNT);

      if (moviesError) {
        console.error("Refresh user movies error:", moviesError);
        return c.json({ error: "İçerik koleksiyonu yenilenemedi." }, 500);
      }

      const {
        data: refreshedCurrentlyWatching,
        error: refreshedWatchingError,
      } = await supabase
        .from("currently_watching")
        .select(
          "movie_id, media_type, state, remaining_ms, expires_at, started_at, paused_at, version, updated_at",
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (refreshedWatchingError) {
        console.error(
          "Refresh currently watching error:",
          refreshedWatchingError,
        );
        return c.json({ error: "İzleme durumu yenilenemedi." }, 500);
      }

      if (
        Object.keys(profileUpdates).length > 0 ||
        privateLocationUpdate ||
        requestedDiscoveryPreferences ||
        favoriteMovies !== undefined ||
        watchedMovies !== undefined ||
        favoriteMedia !== undefined ||
        watchedMedia !== undefined ||
        requestedWatchingMutation
      ) {
        queueUserEvents(supabase, [userId], "profile_changed", {
          watchChanged: requestedWatchingMutation,
          collectionsChanged: favoriteMovies !== undefined ||
            watchedMovies !== undefined ||
            favoriteMedia !== undefined ||
            watchedMedia !== undefined,
        });
        queueUserEvents(supabase, [userId], "discovery_changed", {
          reason: "profile",
        });
      }

      if (requestedWatchingMutation) {
        queueWatchSessionDiscoveryEvents(supabase, userId, [
          previousWatchingForEvents?.state === "active"
            ? {
              movieId: previousWatchingForEvents.movie_id,
              mediaType: previousWatchingForEvents.media_type,
            }
            : {},
          refreshedCurrentlyWatching?.state === "active"
            ? {
              movieId: refreshedCurrentlyWatching.movie_id,
              mediaType: refreshedCurrentlyWatching.media_type,
            }
            : {},
        ]);
      }

      const [signedProfile] = await signProfilePhotosForPayloads(supabase, [
        buildUserPayload(
          profile,
          movies ?? [],
          refreshedCurrentlyWatching,
          nextDiscoveryPreferences,
          userId,
        ),
      ]);

      return c.json({
        success: true,
        profile: signedProfile,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      return c.json({ error: "Profil güncellenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/watch/live-now", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const requestedLimit = Number(c.req.query("limit") ?? LIVE_NOW_PAGE_SIZE);
      const pageSize = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 120)
        : LIVE_NOW_PAGE_SIZE;
      const cursor = decodeLiveNowCursor(c.req.query("cursor"));
      const { data: watchingRows, error: watchingError } = await supabase.rpc(
        "get_live_now_users",
        {
          p_current_user_id: currentUserId,
          p_cursor_updated_at: cursor?.updatedAt,
          p_cursor_user_id: cursor?.userId,
          p_limit: pageSize + 1,
        },
      );

      if (watchingError) {
        console.error("Live now fetch error:", watchingError);
        return c.json({ error: "Canlı izleme listesi yüklenemedi." }, 500);
      }

      const candidateRows = (watchingRows ?? []) as Array<{
        user_id: string;
        movie_id: number;
        media_type: MediaType | string | null;
        updated_at: string;
      }>;
      const visibleRows = candidateRows.slice(0, pageSize);
      const userIds = [
        ...new Set(visibleRows.map((row: { user_id: string }) => row.user_id)),
      ];
      const payloadMap = await loadUserPayloadMap(supabase, userIds);

      return c.json({
        users: userIds
          .map((userId) => payloadMap.get(userId))
          .filter((user): user is DatabaseRow => user != null),
        pageInfo: {
          hasMore: candidateRows.length > pageSize,
          nextCursor: encodeLiveNowCursor(visibleRows.at(-1) ?? {}),
        },
      });
    } catch (error) {
      console.error("Live now error:", error);
      return c.json({ error: "Canlı izleme listesi yüklenemedi." }, 500);
    }
  });

  app.get("/make-server-d962235e/users", authMiddleware, (c) =>
    c.json({
      error: "Bu eski kullanıcı dizini artık desteklenmiyor.",
      users: [],
      pageInfo: { hasMore: false, nextCursor: null },
    }, 410));

  app.get(
    "/make-server-d962235e/discovery/watch",
    authMiddleware,
    async (c) => {
      try {
        const currentUserId = c.get("userId");
        const supabase = getSupabase();
        const requestedLimit = Number(
          c.req.query("limit") ?? DEFAULT_WATCH_DISCOVERY_PAGE_SIZE,
        );
        const pageSize = Number.isFinite(requestedLimit)
          ? Math.min(
            Math.max(Math.floor(requestedLimit), 1),
            MAX_WATCH_DISCOVERY_PAGE_SIZE,
          )
          : DEFAULT_WATCH_DISCOVERY_PAGE_SIZE;
        const rawCursor = c.req.query("cursor");
        const cursor = decodeLiveNowCursor(rawCursor);

        if (rawCursor && !cursor) {
          return c.json({ error: "İzle keşif sayfası isteği geçersiz." }, 400);
        }

        const { data: currentWatching, error: currentWatchingError } =
          await supabase
            .from("currently_watching")
            .select("movie_id, media_type")
            .eq("user_id", currentUserId)
            .eq("state", "active")
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

        if (currentWatchingError) {
          throw currentWatchingError;
        }

        const movieId = currentWatching?.movie_id ?? null;
        const mediaType = normalizeMediaType(currentWatching?.media_type);

        if (!movieId) {
          return c.json({
            users: [],
            pageInfo: { hasMore: false, nextCursor: null },
          });
        }

        const { data: watchingData, error: watchingError } = await supabase.rpc(
          "get_watch_discovery_candidate_page",
          {
            p_current_user_id: currentUserId,
            p_movie_id: movieId,
            p_media_type: mediaType,
            p_cursor_updated_at: cursor?.updatedAt,
            p_cursor_user_id: cursor?.userId,
            p_limit: pageSize + 1,
          },
        );

        if (watchingError) {
          throw watchingError;
        }

        const watchingRows = (watchingData ?? []) as Array<{
          user_id: string;
          updated_at: string;
          compatibility_score: number;
        }>;
        const visibleWatchingRows = watchingRows.slice(0, pageSize);
        const hasMore = watchingRows.length > pageSize;
        const userIds = visibleWatchingRows.map((row) => row.user_id);

        if (userIds.length === 0) {
          return c.json({
            users: [],
            pageInfo: { hasMore: false, nextCursor: null },
          });
        }

        const payloadMap = await loadUserPayloadMap(supabase, userIds);
        const users = userIds.map((userId) => payloadMap.get(userId));

        if (users.some((user) => !user)) {
          throw new Error(
            "Watch discovery read model returned an unresolvable profile.",
          );
        }

        return c.json({
          users: users as DatabaseRow[],
          pageInfo: {
            hasMore,
            nextCursor: hasMore
              ? encodeLiveNowCursor(visibleWatchingRows.at(-1) ?? {})
              : null,
          },
        });
      } catch (error) {
        console.error("Watch discovery error:", error);
        return c.json({ error: "İzle keşfi yüklenemedi." }, 500);
      }
    },
  );

  app.get(
    "/make-server-d962235e/discovery/compatibility",
    authMiddleware,
    async (c) => {
      try {
        const currentUserId = c.get("userId");
        const supabase = getSupabase();
        const requestedLimit = Number(
          c.req.query("limit") ?? DEFAULT_COMPATIBILITY_PAGE_SIZE,
        );
        const pageSize = Number.isFinite(requestedLimit)
          ? Math.min(
            Math.max(Math.floor(requestedLimit), 1),
            MAX_COMPATIBILITY_PAGE_SIZE,
          )
          : DEFAULT_COMPATIBILITY_PAGE_SIZE;
        const rawCursor = c.req.query("cursor");
        const cursor = decodeCompatibilityCursor(rawCursor);

        if (rawCursor && !cursor) {
          return c.json({ error: "Uyum keşif sayfası isteği geçersiz." }, 400);
        }

        const { data: candidateData, error: candidateError } = await supabase
          .rpc(
            "get_compatibility_candidate_page",
            {
              p_current_user_id: currentUserId,
              p_cursor_score: cursor?.score,
              p_cursor_user_id: cursor?.userId,
              p_limit: pageSize + 1,
            },
          );

        if (candidateError) {
          throw candidateError;
        }

        const candidateRows = (candidateData ?? []) as Array<{
          user_id: string;
          compatibility_score: number | string;
        }>;
        const visibleCandidateRows = candidateRows.slice(0, pageSize);
        const hasMore = candidateRows.length > pageSize;
        const candidateUserIds = visibleCandidateRows.map((row) => row.user_id);

        if (candidateUserIds.length === 0) {
          return c.json({
            algorithmVersion: 1,
            entries: [],
            pageInfo: { hasMore: false, nextCursor: null },
          });
        }

        const payloadMap = await loadUserPayloadMap(supabase, candidateUserIds);
        const entries = visibleCandidateRows.map((row) => ({
          user: payloadMap.get(row.user_id),
          score: Number(row.compatibility_score),
        }));

        if (
          entries.some((entry) => !entry.user || !Number.isInteger(entry.score))
        ) {
          throw new Error(
            "Compatibility discovery read model returned an invalid row.",
          );
        }

        return c.json({
          algorithmVersion: 1,
          entries: entries as Array<{ user: DatabaseRow; score: number }>,
          pageInfo: {
            hasMore,
            nextCursor: hasMore
              ? encodeCompatibilityCursor(visibleCandidateRows.at(-1) ?? {})
              : null,
          },
        });
      } catch (error) {
        console.error("Compatibility discovery error:", error);
        return c.json({ error: "Uyum keşfi yüklenemedi." }, 500);
      }
    },
  );
};
