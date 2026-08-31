import {
  AccountDeletionResumeError,
  MAX_AVAILABILITY_CHECKS_PER_MINUTE,
  MAX_PASSWORD_RESET_LOOKUPS_PER_HOUR,
  MAX_PASSWORD_RESET_REQUESTS_PER_HOUR,
  app,
  authMiddleware,
  buildAbuseKey,
  enforceRateLimit,
  extractManagedProfilePhotoPaths,
  findProfileByUsername,
  getErrorMessage,
  getRequestRateLimitIdentity,
  getSupabase,
  getUsernameValidationMessage,
  isTrustedPasswordResetRedirect,
  normalizeEmail,
  normalizeUsername,
  resumeAccountDeletionJob,
} from "../runtime.ts";

export const AUTH_ROUTES = [
  { method: "POST", path: "/make-server-d962235e/auth/check-availability", domain: "auth" },
  { method: "POST", path: "/make-server-d962235e/auth/password-reset", domain: "auth" },
  { method: "POST", path: "/make-server-d962235e/auth/signup", domain: "auth" },
  { method: "DELETE", path: "/make-server-d962235e/account", domain: "auth" },
  { method: "POST", path: "/make-server-d962235e/account-deletion-jobs/resume", domain: "auth" },
] as const;

export const registerAuthRoutes = () => {
  app.post("/make-server-d962235e/auth/check-availability", async (c) => {
    try {
      const { email, username } = await c.req.json();
      const supabase = getSupabase();
      const rateLimit = await enforceRateLimit(supabase, {
        action: "auth_check_availability",
        key: buildAbuseKey([getRequestRateLimitIdentity(c), typeof email === "string" ? normalizeEmail(email) : "", typeof username === "string" ? username : ""]),
        limit: MAX_AVAILABILITY_CHECKS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok sık kontrol yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
      }

      if (!email && !username) {
        return c.json({ error: "E-posta veya kullanıcı adı gerekli." }, 400);
      }

      let emailAvailable = true;
      let usernameAvailable = true;
      let emailMessage: string | undefined;
      let usernameMessage: string | undefined;
      let normalizedUsername: string | undefined;

      if (typeof email === "string" && email.trim().length > 0) {
        const normalizedEmail = normalizeEmail(email);

        if (
          normalizedEmail.length > 320 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ) {
          emailAvailable = false;
          emailMessage = "Geçerli bir e-posta gir.";
        }
      }

      if (typeof username === "string" && username.trim().length > 0) {
        normalizedUsername = normalizeUsername(username);
        const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);
        if (usernameValidationMessage) {
          usernameAvailable = false;
          usernameMessage = usernameValidationMessage;
        }

        if (!usernameAvailable) {
          return c.json({
            emailAvailable,
            usernameAvailable,
            normalizedUsername,
            emailMessage,
            usernameMessage,
          });
        }

        const existingProfile = await findProfileByUsername(supabase, normalizedUsername);
        usernameAvailable = !existingProfile;
        if (!usernameAvailable) {
          usernameMessage = "Bu kullanıcı adı zaten kullanılıyor.";
        }
      }

      return c.json({
        emailAvailable,
        usernameAvailable,
        normalizedUsername,
        emailMessage,
        usernameMessage,
      });
    } catch (error) {
      console.error("Availability check error:", error);
      return c.json({ error: "Uygunluk kontrolü yapılamadı." }, 500);
    }
  });

  app.post("/make-server-d962235e/auth/password-reset", async (c) => {
    try {
      const { email, redirectTo } = await c.req.json();
      const supabase = getSupabase();
      const normalizedEmail = typeof email === "string" ? normalizeEmail(email) : "";
      const requestIdentity = getRequestRateLimitIdentity(c);
      const [rateLimit, lookupRateLimit] = await Promise.all([
        enforceRateLimit(supabase, {
          action: "auth_password_reset",
          key: buildAbuseKey([requestIdentity, normalizedEmail]),
          limit: MAX_PASSWORD_RESET_REQUESTS_PER_HOUR,
          windowSeconds: 60 * 60,
        }),
        enforceRateLimit(supabase, {
          action: "auth_password_reset_lookup",
          key: buildAbuseKey([requestIdentity]),
          limit: MAX_PASSWORD_RESET_LOOKUPS_PER_HOUR,
          windowSeconds: 60 * 60,
        }),
      ]);

      if (!rateLimit.allowed || !lookupRateLimit.allowed) {
        return c.json({ error: "Çok sık şifre sıfırlama isteği gönderdin. Lütfen daha sonra tekrar dene." }, 429);
      }

      if (!normalizedEmail) {
        return c.json({ error: "E-posta adresi gerekli." }, 400);
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return c.json({ error: "Geçerli bir e-posta adresi gir." }, 400);
      }

      if (!isTrustedPasswordResetRedirect(redirectTo)) {
        return c.json({ error: "Şifre sıfırlama yönlendirmesi geçersiz." }, 400);
      }

      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });

      if (error) {
        console.error("Password reset delivery error:", {
          code: (error as { code?: string })?.code,
          status: (error as { status?: number })?.status,
          message: getErrorMessage(error, "delivery failed"),
        });
      }

      // Always return the same response for a syntactically valid address. Revealing
      // provider delivery or account-existence state enables account enumeration.
      return c.json({
        success: true,
        message: "E-posta adresi kayıtlıysa şifre sıfırlama bağlantısı gönderildi.",
      }, 202);
    } catch (error) {
      console.error("Password reset request error:", error);
      return c.json({ error: "Şifre sıfırlama isteği tamamlanamadı." }, 500);
    }
  });

  app.post("/make-server-d962235e/auth/signup", async (c) => {
    return c.json(
      {
        error:
          "Bu endpoint devre dışı. Kayıt akışı artık mail doğrulamalı Supabase signUp üzerinden istemci tarafında çalışıyor.",
      },
      410,
    );
  });

  app.delete("/make-server-d962235e/account", authMiddleware, async (c) => {
    try {
      const userId = c.get("userId");
      const supabase = getSupabase();
      const { data: existingJob, error: existingJobError } = await supabase
        .from("account_deletion_jobs")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingJobError) {
        throw existingJobError;
      }

      if (!existingJob) {
        const { data: profileForDeletion, error: profileLoadError } = await supabase
          .from("profiles")
          .select("photos")
          .eq("id", userId)
          .maybeSingle();

        if (profileLoadError) {
          throw profileLoadError;
        }

        const { error: createJobError } = await supabase
          .from("account_deletion_jobs")
          .insert({
            user_id: userId,
            photo_paths: extractManagedProfilePhotoPaths(profileForDeletion?.photos ?? [], userId),
            stage: "requested",
          });

        if (createJobError && (createJobError as { code?: string }).code !== "23505") {
          throw createJobError;
        }
      }

      try {
        const result = await resumeAccountDeletionJob(supabase, userId);
        return c.json(result);
      } catch (error) {
        if (error instanceof AccountDeletionResumeError && error.accountRemoved) {
          return c.json({ success: true, cleanupPending: true, stage: "auth_deleted" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Delete account error:", error);
      return c.json({ error: "Hesap silinemedi." }, 500);
    }
  });

  app.post("/make-server-d962235e/account-deletion-jobs/resume", async (c) => {
    const configuredSecret = Deno.env.get("ACCOUNT_DELETION_WORKER_SECRET")?.trim();
    const providedSecret = c.req.header("X-WMatch-Worker-Secret")?.trim();

    if (!configuredSecret) {
      return c.json({ error: "Account deletion worker is not configured." }, 503);
    }

    if (!providedSecret || providedSecret !== configuredSecret) {
      return c.json({ error: "Unauthorized account deletion worker request." }, 401);
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const userId = typeof body?.userId === "string" ? body.userId.trim() : "";

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        return c.json({ error: "Invalid account deletion job user ID." }, 400);
      }

      const supabase = getSupabase();
      const { data: existingJob, error: jobError } = await supabase
        .from("account_deletion_jobs")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (jobError) {
        throw jobError;
      }

      if (!existingJob) {
        return c.json({ error: "Account deletion job not found." }, 404);
      }

      const result = await resumeAccountDeletionJob(supabase, userId);
      return c.json(result);
    } catch (error) {
      console.error("Resume account deletion job error:", error);
      return c.json({ error: "Account deletion job could not be resumed." }, 500);
    }
  });
};
