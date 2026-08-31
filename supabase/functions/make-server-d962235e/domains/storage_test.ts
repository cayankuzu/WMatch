import {
  finalizeValidatedProfilePhotos,
  hasForbiddenProfilePhotoMetadata,
  inspectProfilePhotoBlob,
  isOwnedManagedPhotoPath,
  isOwnedQuarantinedPhotoPath,
  ProfilePhotoValidationError,
  validateAndStageOwnedProfilePhotos,
} from "./storage.ts";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const CLEAN_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==";

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertRejectsValidation = async (operation: () => Promise<unknown>) => {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof ProfilePhotoValidationError,
      "expected a profile photo validation error",
    );
    return;
  }
  throw new Error("expected validation to reject");
};

Deno.test("profile photo inspection decodes a bounded metadata-free image", async () => {
  const blob = new Blob([decodeBase64(CLEAN_PNG_BASE64)], {
    type: "image/png",
  });
  const inspection = await inspectProfilePhotoBlob(blob);
  assert(
    inspection.width === 1 && inspection.height === 1,
    "decoded dimensions must be exact",
  );
  assert(inspection.mimeType === "image/png", "decoded MIME must be preserved");
});

Deno.test("profile photo inspection rejects metadata and content-type spoofing", async () => {
  const clean = decodeBase64(CLEAN_PNG_BASE64);
  const iendOffset = clean.findIndex((_, index) => (
    String.fromCharCode(...clean.slice(index + 4, index + 8)) === "IEND"
  ));
  assert(iendOffset > 0, "fixture must contain IEND");
  const textChunk = new Uint8Array([
    0,
    0,
    0,
    0,
    0x74,
    0x45,
    0x58,
    0x74,
    0,
    0,
    0,
    0,
  ]);
  const withMetadata = new Uint8Array(clean.length + textChunk.length);
  withMetadata.set(clean.slice(0, iendOffset), 0);
  withMetadata.set(textChunk, iendOffset);
  withMetadata.set(clean.slice(iendOffset), iendOffset + textChunk.length);

  assert(
    hasForbiddenProfilePhotoMetadata("image/png", withMetadata),
    "text metadata must be rejected",
  );
  await assertRejectsValidation(() =>
    inspectProfilePhotoBlob(new Blob([clean], { type: "text/plain" }))
  );
});

Deno.test("profile photo quarantine stages only owner paths and finalizes idempotently", async () => {
  const cleanBlob = new Blob([decodeBase64(CLEAN_PNG_BASE64)], {
    type: "image/png",
  });
  const quarantinePath = `${OWNER_ID}/.quarantine/photo.png`;
  const finalPath = `${OWNER_ID}/photo.png`;
  const stored = new Map([[quarantinePath, cleanBlob]]);
  const moves: string[] = [];
  const bucket = {
    download: async (path: string) => ({
      data: stored.get(path) ?? null,
      error: stored.has(path) ? null : new Error("missing"),
    }),
    move: async (sourcePath: string, destinationPath: string) => {
      const value = stored.get(sourcePath);
      if (!value) return { data: null, error: new Error("missing") };
      stored.delete(sourcePath);
      stored.set(destinationPath, value);
      moves.push(`${sourcePath}->${destinationPath}`);
      return { data: {}, error: null };
    },
    remove: async (paths: string[]) => {
      paths.forEach((path) => stored.delete(path));
      return { data: {}, error: null };
    },
  };
  const supabase = { storage: { from: () => bucket } } as unknown as Parameters<
    typeof validateAndStageOwnedProfilePhotos
  >[0];
  const publicUrl = `${
    Deno.env.get("SUPABASE_URL")
  }/storage/v1/object/public/profile-photos/${quarantinePath}`;

  assert(
    isOwnedQuarantinedPhotoPath(quarantinePath, OWNER_ID),
    "quarantine path must be owner scoped",
  );
  assert(
    isOwnedManagedPhotoPath(finalPath, OWNER_ID),
    "final path must be owner scoped",
  );
  const staged = await validateAndStageOwnedProfilePhotos(supabase, OWNER_ID, [
    publicUrl,
  ], []);
  assert(
    staged.pendingMoves.length === 1,
    "new upload must require one finalization move",
  );
  assert(
    staged.photos[0].endsWith(`profile-photos/${finalPath}`),
    "profile must store only final paths",
  );

  await finalizeValidatedProfilePhotos(supabase, staged.pendingMoves);
  assert(
    moves.length === 1 && stored.has(finalPath),
    "quarantine object must move to final storage once",
  );

  const retried = await validateAndStageOwnedProfilePhotos(supabase, OWNER_ID, [
    publicUrl,
  ], [staged.photos[0]]);
  assert(
    retried.pendingMoves.length === 0,
    "retry after a lost response must be idempotent",
  );
  await assertRejectsValidation(() =>
    validateAndStageOwnedProfilePhotos(
      supabase,
      OWNER_ID,
      [staged.photos[0]],
      [],
    )
  );
});
