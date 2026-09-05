import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.107.0";
import type { Database } from "../../types/database.generated.ts";

type SupabaseAdminClient = SupabaseClient<Database>;
type AccountDeletionStage =
  | "requested"
  | "related_data_deleted"
  | "storage_deleted"
  | "auth_deleted"
  | "completed";

const PROFILE_PHOTOS_BUCKET = "profile-photos";
const STORAGE_LIST_PAGE_SIZE = 100;
const STORAGE_DELETE_BATCH_SIZE = 100;
const MAX_ACCOUNT_STORAGE_OBJECTS = 10_000;
const MAX_ACCOUNT_STORAGE_DEPTH = 8;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown } | null)?.message === "string"
      ? String((error as { message: string }).message)
      : fallback;

const isOwnedManagedPhotoPath = (path: string, ownerUserId: string) => {
  const segments = path.split("/");
  return segments.length === 2
    && segments[0] === ownerUserId
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(segments[1])
    && segments[1] !== "."
    && segments[1] !== "..";
};

const isMissingAuthUserError = (error: unknown) => {
  const message = getErrorMessage(error, "").toLowerCase();
  const status = (error as { status?: number } | null)?.status;
  return status === 404 || message.includes("user not found") || message.includes("does not exist");
};

const isSafeStorageSegment = (value: string) =>
  value.length > 0
  && value.length <= 180
  && value !== "."
  && value !== ".."
  && !value.includes("/")
  && !value.includes("\\");

const listAccountStorageObjects = async (
  supabase: SupabaseAdminClient,
  userId: string,
) => {
  const prefixes: Array<{ path: string; depth: number }> = [{ path: userId, depth: 0 }];
  const visitedPrefixes = new Set<string>();
  const objectPaths: string[] = [];

  while (prefixes.length > 0) {
    const current = prefixes.shift();
    if (!current || visitedPrefixes.has(current.path)) continue;
    visitedPrefixes.add(current.path);

    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).list(
        current.path,
        {
          limit: STORAGE_LIST_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        },
      );
      if (error) throw error;

      const entries = data ?? [];
      for (const entry of entries) {
        if (!isSafeStorageSegment(entry.name)) {
          throw new Error("Unsafe account storage object name encountered.");
        }

        const path = `${current.path}/${entry.name}`;
        const isObject = typeof entry.id === "string" || entry.metadata != null;
        if (isObject) {
          objectPaths.push(path);
          if (objectPaths.length > MAX_ACCOUNT_STORAGE_OBJECTS) {
            throw new Error("Account storage cleanup object limit exceeded.");
          }
        } else {
          if (current.depth >= MAX_ACCOUNT_STORAGE_DEPTH) {
            throw new Error("Account storage cleanup depth limit exceeded.");
          }
          prefixes.push({ path, depth: current.depth + 1 });
        }
      }

      if (entries.length < STORAGE_LIST_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  return [...new Set(objectPaths)];
};

export const removeAccountStorageObjects = async (
  supabase: SupabaseAdminClient,
  userId: string,
  snapshotPaths: string[],
) => {
  const discoveredPaths = await listAccountStorageObjects(supabase, userId);
  const paths = [...new Set([...snapshotPaths, ...discoveredPaths])];

  for (let offset = 0; offset < paths.length; offset += STORAGE_DELETE_BATCH_SIZE) {
    const { error } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .remove(paths.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE));
    if (error) throw error;
  }

  const remainingPaths = await listAccountStorageObjects(supabase, userId);
  if (remainingPaths.length > 0) {
    throw new Error("Account storage objects remained after deletion.");
  }
};

export class AccountDeletionResumeError extends Error {
  constructor(
    message: string,
    readonly accountRemoved: boolean,
  ) {
    super(message);
    this.name = "AccountDeletionResumeError";
  }
}

export const resumeAccountDeletionJob = async (
  supabase: SupabaseAdminClient,
  userId: string,
) => {
  const { data: job, error: jobLoadError } = await supabase
    .from("account_deletion_jobs")
    .select("user_id, photo_paths, stage, completed_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (jobLoadError) throw jobLoadError;
  if (!job) throw new Error("Account deletion job not found.");

  let stage = job.stage as AccountDeletionStage;
  let authUserRemoved = stage === "auth_deleted";
  const photoPaths = Array.isArray(job.photo_paths)
    ? job.photo_paths.filter(
        (path): path is string => typeof path === "string" && isOwnedManagedPhotoPath(path, userId),
      )
    : [];
  const persistStage = async (nextStage: AccountDeletionStage, lastError: string | null = null) => {
    const { error } = await supabase
      .from("account_deletion_jobs")
      .update({
        stage: nextStage,
        last_error: lastError,
        updated_at: new Date().toISOString(),
        completed_at: nextStage === "completed" ? new Date().toISOString() : null,
      })
      .eq("user_id", userId);

    if (error) throw error;
    stage = nextStage;
  };

  if (stage === "completed") {
    return { success: true, cleanupPending: false, stage } as const;
  }

  try {
    if (stage === "requested") {
      const [notificationCleanup, moderationCleanup] = await Promise.all([
        supabase
          .from("notification_events")
          .delete()
          .or(`actor_user_id.eq.${userId},route_user_id.eq.${userId}`),
        supabase
          .from("moderation_reports")
          .delete()
          .or(`reporter_user_id.eq.${userId},target_user_id.eq.${userId}`),
      ]);

      if (notificationCleanup.error) throw notificationCleanup.error;
      if (moderationCleanup.error) throw moderationCleanup.error;
      await persistStage("related_data_deleted");
    }

    if (stage === "related_data_deleted") {
      await removeAccountStorageObjects(supabase, userId, photoPaths);
      await persistStage("storage_deleted");
    }

    if (stage === "storage_deleted") {
      const { error } = await supabase.auth.admin.deleteUser(userId, false);
      if (error && !isMissingAuthUserError(error)) throw error;
      authUserRemoved = true;
      await persistStage("auth_deleted");
    }

    if (stage === "auth_deleted") {
      const { error: profileDeleteError } = await supabase.from("profiles").delete().eq("id", userId);
      if (profileDeleteError) throw profileDeleteError;

      const { data: remainingProfile, error: verifyError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (verifyError) throw verifyError;
      if (remainingProfile) throw new Error("Profile row remained after account deletion.");
      await persistStage("completed");
    }

    return { success: true, cleanupPending: false, stage } as const;
  } catch (error) {
    const accountRemoved = authUserRemoved;
    await persistStage(stage, getErrorMessage(error, "Account deletion resume failed.")).catch(() => undefined);
    throw new AccountDeletionResumeError(
      getErrorMessage(error, "Account deletion resume failed."),
      accountRemoved,
    );
  }
};
