import type { SupabaseAdminClient } from "../sharedMiddleware.ts";

const PROFILE_PHOTOS_BUCKET = "profile-photos";
const LIST_PAGE_SIZE = 100;
const CLEANUP_LIMIT = 1_000;

export const PROFILE_PHOTO_QUARANTINE_SEGMENT = ".quarantine";
export const PROFILE_PHOTO_QUARANTINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const isSafeStorageObjectName = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value)
  && value !== "."
  && value !== "..";

export const cleanupStaleProfilePhotoQuarantine = async (
  supabase: SupabaseAdminClient,
  ownerUserId: string,
  now = Date.now(),
) => {
  const quarantinePath = `${ownerUserId}/${PROFILE_PHOTO_QUARANTINE_SEGMENT}`;
  const stalePaths: string[] = [];
  let offset = 0;

  while (offset < CLEANUP_LIMIT) {
    const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET)
      .list(quarantinePath, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "created_at", order: "asc" },
      });
    if (error) {
      console.error("Profile photo quarantine cleanup list failed.");
      return;
    }

    const entries = data ?? [];
    stalePaths.push(...entries.flatMap(
      (item: { name?: string | null; created_at?: string | null }) => {
        const createdAt = typeof item.created_at === "string"
          ? new Date(item.created_at).getTime()
          : Number.NaN;
        return item.name
            && isSafeStorageObjectName(item.name)
            && Number.isFinite(createdAt)
            && now - createdAt >= PROFILE_PHOTO_QUARANTINE_MAX_AGE_MS
          ? [`${quarantinePath}/${item.name}`]
          : [];
      },
    ));

    if (entries.length < LIST_PAGE_SIZE) break;
    offset += entries.length;
  }

  for (let deleteOffset = 0; deleteOffset < stalePaths.length; deleteOffset += LIST_PAGE_SIZE) {
    const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(
      stalePaths.slice(deleteOffset, deleteOffset + LIST_PAGE_SIZE),
    );
    if (error) {
      console.error("Profile photo quarantine cleanup delete failed.");
      return;
    }
  }
};
