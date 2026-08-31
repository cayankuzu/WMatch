import nodemailer from "npm:nodemailer@9.0.3";
import {
  app,
  authMiddleware,
  buildAbuseKey,
  enforceRateLimit,
  getErrorMessage,
  getRequestRateLimitIdentity,
  getSupabase,
  hashIdempotencyPayload,
  isDatabaseRow,
  isMissingRelationError,
  loadUserPayloadMap,
  normalizeEmail,
  normalizeIdempotencyKey,
  normalizeWhitespace,
} from "../runtime.ts";
import type {
  DatabaseRow,
  JsonObject,
} from "../runtime.ts";

const MAX_REPORTS_PER_HOUR = 12;
const MIN_REPORT_DETAILS_LENGTH = 20;
const MAX_REPORT_DETAILS_LENGTH = 1500;
const REPORT_REASON_CODES = new Set<string>([
  "fake_profile",
  "harassment",
  "spam",
  "nudity",
  "underage",
  "hate_speech",
  "other",
]);
const REPORT_TARGET_TYPES = new Set<string>(["profile", "chat_message", "match", "other"]);
const MODERATION_REPORT_TO_EMAIL =
  normalizeEmail(Deno.env.get("MODERATION_REPORT_TO_EMAIL") ?? "");
const MODERATION_REPORT_FROM_EMAIL =
  normalizeEmail(Deno.env.get("MODERATION_REPORT_FROM_EMAIL") ?? "");
const MODERATION_REPORT_FROM_NAME =
  (Deno.env.get("MODERATION_REPORT_FROM_NAME") ?? "WMatch Moderation").trim() || "WMatch Moderation";
const MODERATION_SMTP_HOST =
  (Deno.env.get("MODERATION_SMTP_HOST") ?? "").trim();
const MODERATION_SMTP_PORT = Number(Deno.env.get("MODERATION_SMTP_PORT") ?? "587");
const MODERATION_SMTP_USERNAME = (Deno.env.get("MODERATION_SMTP_USERNAME") ?? "").trim();
const MODERATION_SMTP_PASSWORD = Deno.env.get("MODERATION_SMTP_PASSWORD") ?? "";
let moderationTransporter: nodemailer.Transporter | null = null;
const sanitizeReportReasonCode = (value: unknown) => {
  if (typeof value !== "string") {
    return "other";
  }

  const normalized = value.trim().toLowerCase();
  return REPORT_REASON_CODES.has(normalized)
    ? normalized
    : "other";
};

const sanitizeReportTargetType = (value: unknown) => {
  if (typeof value !== "string") {
    return "profile";
  }

  const normalized = value.trim().toLowerCase();
  return REPORT_TARGET_TYPES.has(normalized)
    ? normalized
    : "profile";
};

const sanitizeReportDetails = (value: unknown) =>
  typeof value === "string" ? normalizeWhitespace(value).trim().slice(0, MAX_REPORT_DETAILS_LENGTH) : "";

const sanitizeReportTimestamp = (value: unknown) => {
  if (typeof value !== "string" || value.length > 40) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

const sanitizeReportMovieIds = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))].slice(0, 20)
    : [];

const sanitizeReportMatchContext = (value: unknown): JsonObject | null => {
  if (!isDatabaseRow(value)) {
    return null;
  }

  const type = value.type === "watch" || value.type === "compatibility" || value.type === "like"
    ? value.type
    : null;

  if (!type) {
    return null;
  }

  return {
    type,
    compatibilityScore:
      typeof value.compatibilityScore === "number" && Number.isFinite(value.compatibilityScore)
        ? Math.min(100, Math.max(0, Math.round(value.compatibilityScore)))
        : null,
    matchedMovieId:
      Number.isInteger(value.matchedMovieId) && Number(value.matchedMovieId) > 0
        ? Number(value.matchedMovieId)
        : null,
    commonFavoriteMovieIds: sanitizeReportMovieIds(value.commonFavoriteMovieIds),
    commonWatchedMovieIds: sanitizeReportMovieIds(value.commonWatchedMovieIds),
    createdAt: sanitizeReportTimestamp(value.createdAt),
  };
};

const sanitizeReportClientContext = (value: unknown): JsonObject => {
  if (!isDatabaseRow(value)) {
    return {};
  }

  const platform = value.platform === "ios" || value.platform === "android" || value.platform === "web"
    ? value.platform
    : "unknown";
  const sanitizeVersion = (candidate: unknown) =>
    typeof candidate === "string" && /^[A-Za-z0-9._+-]{1,40}$/.test(candidate.trim())
      ? candidate.trim()
      : null;
  const reportedFrom =
    typeof value.reportedFrom === "string" && /^[a-z0-9_-]{1,40}$/i.test(value.reportedFrom.trim())
      ? value.reportedFrom.trim().toLowerCase()
      : null;

  return {
    platform,
    appVersion: sanitizeVersion(value.appVersion),
    buildVersion: sanitizeVersion(value.buildVersion),
    blockedByReporter: value.blockedByReporter === true,
    reportedFrom,
    reportedAt: sanitizeReportTimestamp(value.reportedAt),
  };
};

const buildReportUserSnapshot = (user: DatabaseRow | null | undefined) => {
  if (!user) {
    return null;
  }

  return {
    id: user.id ?? null,
    name: user.name ?? null,
    username: user.username ?? null,
    emailConfirmed: user.email_confirmed === true,
  };
};

const getModerationTransporter = () => {
  if (
    !MODERATION_REPORT_TO_EMAIL ||
    !MODERATION_REPORT_FROM_EMAIL ||
    !MODERATION_SMTP_HOST ||
    !MODERATION_SMTP_USERNAME ||
    !MODERATION_SMTP_PASSWORD
  ) {
    return null;
  }

  if (!moderationTransporter) {
    moderationTransporter = nodemailer.createTransport({
      host: MODERATION_SMTP_HOST,
      port: Number.isFinite(MODERATION_SMTP_PORT) ? MODERATION_SMTP_PORT : 587,
      secure: false,
      auth: {
        user: MODERATION_SMTP_USERNAME,
        pass: MODERATION_SMTP_PASSWORD,
      },
    });
  }

  return moderationTransporter;
};

const sendModerationReportEmail = async (report: {
  id: string;
  targetType: string;
  reasonCode: string;
  createdAt: string;
  slaDueAt: string;
}) => {
  const transporter = getModerationTransporter();

  if (!transporter) {
    return false;
  }

  const subject = `[WMatch] Yeni ${report.targetType} sikayeti | ${report.reasonCode} | ${report.id}`;
  const text = [
    "WMatch moderation report",
    `Report ID: ${report.id}`,
    `Target Type: ${report.targetType}`,
    `Reason Code: ${report.reasonCode}`,
    `Created At: ${report.createdAt}`,
    `SLA Due At: ${report.slaDueAt}`,
    "",
    "Review the full case in the restricted moderation case store.",
  ].join("\n");

  await transporter.sendMail({
    from: {
      address: MODERATION_REPORT_FROM_EMAIL,
      name: MODERATION_REPORT_FROM_NAME,
    },
    to: MODERATION_REPORT_TO_EMAIL,
    subject,
    text,
  });

  return true;
};

export const MODERATION_ROUTES = [
  { method: "POST", path: "/make-server-d962235e/reports", domain: "moderation" },
] as const;

export const registerModerationRoutes = () => {
  app.post("/make-server-d962235e/reports", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();
      const body = await c.req.json().catch(() => ({}));
      const targetType = sanitizeReportTargetType(body?.targetType);
      const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId.trim() : "";
      const targetRecordId =
        typeof body?.targetRecordId === "string" && body.targetRecordId.trim().length > 0
          ? body.targetRecordId.trim().slice(0, 160)
          : null;
      const reasonCode = sanitizeReportReasonCode(body?.reasonCode);
      const details = sanitizeReportDetails(body?.details);
      const matchContext = sanitizeReportMatchContext(body?.matchContext);
      const clientContext = sanitizeReportClientContext(body?.clientContext);
      const rawIdempotencyKey = c.req.header("Idempotency-Key");
      const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

      if (targetType === "profile" && (!targetUserId || targetUserId === currentUserId)) {
        return c.json({ error: "Geçersiz şikâyet hedefi." }, 400);
      }

      if (details.length < MIN_REPORT_DETAILS_LENGTH) {
        return c.json({ error: "Şikâyet ayrıntılarını daha açık yazmalısın." }, 400);
      }

      if (rawIdempotencyKey && !idempotencyKey) {
        return c.json({ error: "Invalid idempotency key." }, 400);
      }

      const rateLimit = await enforceRateLimit(supabase, {
        action: "report_user",
        key: buildAbuseKey([currentUserId, targetUserId, getRequestRateLimitIdentity(c)]),
        limit: MAX_REPORTS_PER_HOUR,
        windowSeconds: 60 * 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok sık şikâyet gönderdin. Lütfen daha sonra tekrar dene." }, 429);
      }

      const userMap = await loadUserPayloadMap(
        supabase,
        [currentUserId, targetUserId].filter(Boolean),
      );
      const reporterSnapshot = buildReportUserSnapshot(userMap.get(currentUserId));
      const targetSnapshot = buildReportUserSnapshot(userMap.get(targetUserId));

      if (targetType === "profile" && !targetSnapshot) {
        return c.json({ error: "Şikâyet edilen profil bulunamadı." }, 404);
      }

      const contextSnapshot = {
        matchContext,
        clientContext,
      };
      const payloadHash = idempotencyKey
        ? await hashIdempotencyPayload(JSON.stringify({
            targetType,
            targetUserId: targetUserId || null,
            targetRecordId,
            reasonCode,
            details,
            contextSnapshot,
          }))
        : null;

      let { data: insertedReport, error } = await supabase
        .from("moderation_reports")
        .insert({
          reporter_user_id: currentUserId,
          target_user_id: targetUserId || null,
          target_type: targetType,
          target_record_id: targetRecordId,
          reason_code: reasonCode,
          details,
          reporter_snapshot: reporterSnapshot ?? {},
          target_snapshot: targetSnapshot ?? {},
          context_snapshot: contextSnapshot,
          idempotency_key: idempotencyKey,
          payload_hash: payloadHash,
        })
        .select("id, target_type, reason_code, created_at, sla_due_at, payload_hash")
        .single();

      let idempotencyReplayed = false;

      if (
        error &&
        idempotencyKey &&
        (((error as { code?: string }).code === "23505") ||
          getErrorMessage(error, "").toLowerCase().includes("duplicate"))
      ) {
        const existingReportResult = await supabase
          .from("moderation_reports")
          .select("id, target_type, reason_code, created_at, sla_due_at, payload_hash")
          .eq("reporter_user_id", currentUserId)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (!existingReportResult.error && existingReportResult.data) {
          if (existingReportResult.data.payload_hash !== payloadHash) {
            return c.json({ error: "Idempotency key was already used for a different report." }, 409);
          }

          insertedReport = existingReportResult.data;
          error = null;
          idempotencyReplayed = true;
        }
      }

      if (error) {
        if (isMissingRelationError(error, "moderation_reports")) {
        return c.json({ error: "Şikâyet sistemi henüz kullanıma hazır değil." }, 503);
        }

        console.error("Create moderation report error:", error);
        return c.json({ error: "Şikâyet kaydedilemedi." }, 400);
      }

      if (!insertedReport) {
        return c.json({ error: "Moderation report could not be verified." }, 500);
      }

      let mailed = false;

      try {
        if (!idempotencyReplayed) {
          mailed = await sendModerationReportEmail({
            id: insertedReport.id,
            targetType: insertedReport.target_type,
            reasonCode: insertedReport.reason_code,
            createdAt: insertedReport.created_at,
            slaDueAt: insertedReport.sla_due_at,
          });
        }
      } catch (mailError) {
        console.error("Moderation report mail error:", mailError);
      }

      return c.json({
        success: true,
        reportId: insertedReport.id,
        mailed,
        idempotencyReplayed,
      });
    } catch (error) {
      console.error("Create moderation report error:", error);
      return c.json({ error: "Şikâyet gönderilemedi." }, 500);
    }
  });
};
