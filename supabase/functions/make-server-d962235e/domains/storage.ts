import { MAX_PROFILE_PHOTOS } from "../../../../src/shared/constants/index.ts";
import type { SupabaseAdminClient } from "../sharedMiddleware.ts";

type DatabaseRow = Record<string, unknown>;

export const PROFILE_PHOTOS_BUCKET = "profile-photos";
export const PROFILE_PHOTOS_PUBLIC_PREFIX = `${Deno.env.get(
  "SUPABASE_URL",
)!}/storage/v1/object/public/${PROFILE_PHOTOS_BUCKET}/`;
export const PROFILE_PHOTOS_SIGNED_PREFIX = `${Deno.env.get(
  "SUPABASE_URL",
)!}/storage/v1/object/sign/${PROFILE_PHOTOS_BUCKET}/`;
export const PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS = 5 * 60;
export const PROFILE_PHOTO_SIGNED_URL_CACHE_TTL_MS =
  (PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS - 30) * 1000;
export const MAX_PROFILE_PHOTO_SIGNED_URL_CACHE_ENTRIES = 1_000;
export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PROFILE_PHOTO_DIMENSION = 4_096;
export const MAX_PROFILE_PHOTO_PIXELS = 16_000_000;
export const PROFILE_PHOTO_QUARANTINE_SEGMENT = ".quarantine";
export const PROFILE_PHOTO_QUARANTINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const signedProfilePhotoCache = new Map<
  string,
  { signedUrl: string; expiresAt: number }
>();
export class ProfilePhotoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfilePhotoValidationError";
  }
}

export const getManagedStoragePath = (photoUrl: string) => {
  const prefix = photoUrl.startsWith(PROFILE_PHOTOS_PUBLIC_PREFIX)
    ? PROFILE_PHOTOS_PUBLIC_PREFIX
    : photoUrl.startsWith(PROFILE_PHOTOS_SIGNED_PREFIX)
    ? PROFILE_PHOTOS_SIGNED_PREFIX
    : null;

  if (!prefix) {
    return null;
  }

  const encodedPath = photoUrl.slice(prefix.length).split("?")[0];

  try {
    const path = decodeURIComponent(encodedPath);
    return path.length > 0 && path.length <= 512 ? path : null;
  } catch {
    return null;
  }
};

export const buildCanonicalManagedPhotoUrl = (path: string) =>
  `${PROFILE_PHOTOS_PUBLIC_PREFIX}${
    path.split("/").map(encodeURIComponent).join("/")
  }`;

export const isOwnedManagedPhotoPath = (path: string, ownerUserId: string) => {
  const segments = path.split("/");
  return segments.length === 2 &&
    segments[0] === ownerUserId &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(segments[1]) &&
    segments[1] !== "." &&
    segments[1] !== "..";
};

export const isOwnedQuarantinedPhotoPath = (
  path: string,
  ownerUserId: string,
) => {
  const segments = path.split("/");
  return segments.length === 3 &&
    segments[0] === ownerUserId &&
    segments[1] === PROFILE_PHOTO_QUARANTINE_SEGMENT &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(segments[2]) &&
    segments[2] !== "." &&
    segments[2] !== "..";
};

const getFinalPathForQuarantine = (path: string, ownerUserId: string) => {
  if (!isOwnedQuarantinedPhotoPath(path, ownerUserId)) {
    return null;
  }

  return `${ownerUserId}/${path.split("/")[2]}`;
};

export const sanitizePhotoList = (photos: unknown, ownerUserId?: string) =>
  Array.isArray(photos)
    ? photos
      .filter((photo): photo is string =>
        typeof photo === "string" && photo.trim().length > 0
      )
      .flatMap((photo) => {
        const normalizedPhoto = photo.trim();
        const managedPath = getManagedStoragePath(normalizedPhoto);
        if (
          !managedPath ||
          (ownerUserId && !isOwnedManagedPhotoPath(managedPath, ownerUserId))
        ) {
          return [];
        }

        return [buildCanonicalManagedPhotoUrl(managedPath)];
      })
      .slice(0, MAX_PROFILE_PHOTOS)
    : [];

export const hasProfilePhotoMagicBytes = (
  mimeType: string,
  bytes: Uint8Array,
) => {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }

  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }

  if (mimeType === "image/webp") {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }

  if (mimeType === "image/heic" || mimeType === "image/heif") {
    if (
      bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp"
    ) {
      return false;
    }

    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    return new Set([
      "heic",
      "heix",
      "hevc",
      "hevx",
      "heim",
      "heis",
      "mif1",
      "msf1",
    ]).has(brand);
  }

  return false;
};

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const readUint32BigEndian = (bytes: Uint8Array, offset: number) => (
  ((bytes[offset] << 24) >>> 0) +
  (bytes[offset + 1] << 16) +
  (bytes[offset + 2] << 8) +
  bytes[offset + 3]
);

const readUint32LittleEndian = (bytes: Uint8Array, offset: number) => (
  bytes[offset] +
  (bytes[offset + 1] << 8) +
  (bytes[offset + 2] << 16) +
  ((bytes[offset + 3] << 24) >>> 0)
);

export const hasForbiddenProfilePhotoMetadata = (
  mimeType: string,
  bytes: Uint8Array,
) => {
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        return true;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset += 1;
      }
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) {
        return false;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > bytes.length) {
        return true;
      }
      const segmentLength = (bytes[offset] << 8) + bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        return true;
      }
      if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
        return true;
      }
      offset += segmentLength;
    }
    return true;
  }

  if (mimeType === "image/png") {
    const forbiddenChunks = new Set([
      "eXIf",
      "iCCP",
      "iTXt",
      "tEXt",
      "tIME",
      "zTXt",
    ]);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const chunkLength = readUint32BigEndian(bytes, offset);
      const chunkType = ascii(bytes, offset + 4, 4);
      const nextOffset = offset + 12 + chunkLength;
      if (nextOffset > bytes.length) {
        return true;
      }
      if (forbiddenChunks.has(chunkType)) {
        return true;
      }
      if (chunkType === "IEND") {
        return nextOffset !== bytes.length;
      }
      offset = nextOffset;
    }
    return true;
  }

  if (mimeType === "image/webp") {
    if (
      bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" ||
      ascii(bytes, 8, 4) !== "WEBP"
    ) {
      return true;
    }
    const declaredLength = readUint32LittleEndian(bytes, 4) + 8;
    if (declaredLength !== bytes.length) {
      return true;
    }
    let offset = 12;
    while (offset + 8 <= declaredLength) {
      const chunkType = ascii(bytes, offset, 4);
      const chunkLength = readUint32LittleEndian(bytes, offset + 4);
      const nextOffset = offset + 8 + chunkLength + (chunkLength % 2);
      if (nextOffset > declaredLength) {
        return true;
      }
      if (
        chunkType === "EXIF" || chunkType === "XMP " || chunkType === "ICCP"
      ) {
        return true;
      }
      offset = nextOffset;
    }
    return offset !== declaredLength;
  }

  return true;
};

export const inspectProfilePhotoBlob = async (data: Blob) => {
  const mimeType = data.type.toLowerCase().split(";")[0].trim();
  if (
    data.size <= 0 ||
    data.size > MAX_PROFILE_PHOTO_BYTES ||
    !ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(mimeType)
  ) {
    throw new ProfilePhotoValidationError(
      "Profil fotoÄŸrafÄ±nÄ±n boyutu veya iÃ§erik tÃ¼rÃ¼ geÃ§ersiz.",
    );
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!hasProfilePhotoMagicBytes(mimeType, bytes)) {
    throw new ProfilePhotoValidationError(
      "Profil fotoÄŸrafÄ±nÄ±n dosya imzasÄ± geÃ§ersiz.",
    );
  }
  if (hasForbiddenProfilePhotoMetadata(mimeType, bytes)) {
    throw new ProfilePhotoValidationError(
      "Profil fotoÄŸrafÄ± gÃ¼venli metadata temizliÄŸinden geÃ§medi.",
    );
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(data);
    const { width, height } = bitmap;
    if (
      width <= 0 ||
      height <= 0 ||
      width > MAX_PROFILE_PHOTO_DIMENSION ||
      height > MAX_PROFILE_PHOTO_DIMENSION ||
      width * height > MAX_PROFILE_PHOTO_PIXELS
    ) {
      throw new ProfilePhotoValidationError(
        "Profil fotoÄŸrafÄ± boyutlarÄ± geÃ§ersiz.",
      );
    }
    return { mimeType, width, height, bytes: data.size };
  } catch (error) {
    if (error instanceof ProfilePhotoValidationError) {
      throw error;
    }
    throw new ProfilePhotoValidationError(
      "Profil fotoÄŸrafÄ± decode edilemedi.",
    );
  } finally {
    bitmap?.close();
  }
};

export const validateOwnedProfilePhotos = async (
  supabase: SupabaseAdminClient,
  ownerUserId: string,
  photos: unknown,
) => {
  if (!Array.isArray(photos) || photos.length > MAX_PROFILE_PHOTOS) {
    throw new ProfilePhotoValidationError("Profil fotoğrafı listesi geçersiz.");
  }

  const normalizedPhotos = photos.map((photo) => {
    if (typeof photo !== "string" || !photo.trim()) {
      throw new ProfilePhotoValidationError(
        "Profil fotoğrafı adresi geçersiz.",
      );
    }

    const managedPath = getManagedStoragePath(photo.trim());
    if (!managedPath || !isOwnedManagedPhotoPath(managedPath, ownerUserId)) {
      throw new ProfilePhotoValidationError(
        "Yalnızca kendi güvenli profil fotoğraflarını kullanabilirsin.",
      );
    }

    return {
      path: managedPath,
      url: buildCanonicalManagedPhotoUrl(managedPath),
    };
  });

  if (
    new Set(normalizedPhotos.map(({ path }) => path)).size !==
      normalizedPhotos.length
  ) {
    throw new ProfilePhotoValidationError(
      "Aynı profil fotoğrafı birden fazla kez kullanılamaz.",
    );
  }

  await Promise.all(normalizedPhotos.map(async ({ path }) => {
    const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET)
      .download(path);
    if (error || !data) {
      throw new ProfilePhotoValidationError(
        "Profil fotoğrafı güvenli depolamada bulunamadı.",
      );
    }

    const mimeType = data.type.toLowerCase().split(";")[0].trim();
    if (
      data.size <= 0 ||
      data.size > MAX_PROFILE_PHOTO_BYTES ||
      !ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(mimeType)
    ) {
      throw new ProfilePhotoValidationError(
        "Profil fotoğrafının boyutu veya içerik türü geçersiz.",
      );
    }

    const bytes = new Uint8Array(await data.slice(0, 32).arrayBuffer());
    if (!hasProfilePhotoMagicBytes(mimeType, bytes)) {
      throw new ProfilePhotoValidationError(
        "Profil fotoğrafının dosya imzası geçersiz.",
      );
    }
  }));

  return normalizedPhotos.map(({ url }) => url);
};

export interface ValidatedProfilePhotoMove {
  sourcePath: string;
  finalPath: string;
}

export interface ValidatedProfilePhotos {
  photos: string[];
  pendingMoves: ValidatedProfilePhotoMove[];
}

const tryDownloadProfilePhoto = async (
  supabase: SupabaseAdminClient,
  path: string,
) => {
  const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET)
    .download(path);
  return error || !data ? null : data;
};

export const validateAndStageOwnedProfilePhotos = async (
  supabase: SupabaseAdminClient,
  ownerUserId: string,
  photos: unknown,
  previousPhotos: unknown = [],
): Promise<ValidatedProfilePhotos> => {
  if (!Array.isArray(photos) || photos.length > MAX_PROFILE_PHOTOS) {
    throw new ProfilePhotoValidationError("Invalid profile photo list.");
  }

  const previousPathSet = new Set(
    sanitizePhotoList(previousPhotos, ownerUserId)
      .map(getManagedStoragePath)
      .filter((path): path is string => Boolean(path)),
  );
  const normalizedPhotos = photos.map((photo) => {
    if (typeof photo !== "string" || !photo.trim()) {
      throw new ProfilePhotoValidationError("Invalid profile photo address.");
    }

    const sourcePath = getManagedStoragePath(photo.trim());
    const quarantined = sourcePath
      ? isOwnedQuarantinedPhotoPath(sourcePath, ownerUserId)
      : false;
    const finalPath = sourcePath && quarantined
      ? getFinalPathForQuarantine(sourcePath, ownerUserId)
      : sourcePath;
    if (
      !sourcePath ||
      !finalPath ||
      (!quarantined && !isOwnedManagedPhotoPath(sourcePath, ownerUserId)) ||
      (!quarantined && !previousPathSet.has(sourcePath))
    ) {
      throw new ProfilePhotoValidationError(
        "Profile photo ownership or quarantine path is invalid.",
      );
    }

    return {
      sourcePath,
      finalPath,
      quarantined,
      url: buildCanonicalManagedPhotoUrl(finalPath),
    };
  });

  if (
    new Set(normalizedPhotos.map(({ finalPath }) => finalPath)).size !==
      normalizedPhotos.length
  ) {
    throw new ProfilePhotoValidationError("Duplicate profile photo path.");
  }

  const pendingMoves = (await Promise.all(
    normalizedPhotos.map(async ({ sourcePath, finalPath, quarantined }) => {
      const sourceData = await tryDownloadProfilePhoto(supabase, sourcePath);
      const data = sourceData ??
        (quarantined
          ? await tryDownloadProfilePhoto(supabase, finalPath)
          : null);
      if (!data) {
        throw new ProfilePhotoValidationError(
          "Profile photo was not found in managed storage.",
        );
      }

      await inspectProfilePhotoBlob(data);
      return quarantined && sourceData ? { sourcePath, finalPath } : null;
    }),
  )).filter((move): move is ValidatedProfilePhotoMove => move !== null);

  return {
    photos: normalizedPhotos.map(({ url }) => url),
    pendingMoves,
  };
};

export const finalizeValidatedProfilePhotos = async (
  supabase: SupabaseAdminClient,
  moves: ValidatedProfilePhotoMove[],
) => {
  const completedMoves: ValidatedProfilePhotoMove[] = [];
  try {
    for (const { sourcePath, finalPath } of moves) {
      const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).move(
        sourcePath,
        finalPath,
      );
      if (!error) {
        completedMoves.push({ sourcePath, finalPath });
        continue;
      }

      const alreadyFinalized = await tryDownloadProfilePhoto(
        supabase,
        finalPath,
      );
      if (!alreadyFinalized) {
        throw new ProfilePhotoValidationError(
          "Profile photo could not be finalized.",
        );
      }
      await inspectProfilePhotoBlob(alreadyFinalized);
      await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove([sourcePath]);
    }
  } catch (error) {
    for (const { sourcePath, finalPath } of completedMoves.reverse()) {
      await supabase.storage.from(PROFILE_PHOTOS_BUCKET).move(
        finalPath,
        sourcePath,
      );
    }
    throw error;
  }
};

export const cleanupStaleProfilePhotoQuarantine = async (
  supabase: SupabaseAdminClient,
  ownerUserId: string,
  now = Date.now(),
) => {
  const quarantinePath = `${ownerUserId}/${PROFILE_PHOTO_QUARANTINE_SEGMENT}`;
  const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET)
    .list(quarantinePath, {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });
  if (error || !data) {
    return;
  }

  const stalePaths = data.flatMap(
    (item: { name?: string | null; created_at?: string | null }) => {
      const createdAt = typeof item.created_at === "string"
        ? new Date(item.created_at).getTime()
        : Number.NaN;
      return item.name &&
          Number.isFinite(createdAt) &&
          now - createdAt >= PROFILE_PHOTO_QUARANTINE_MAX_AGE_MS
        ? [`${quarantinePath}/${item.name}`]
        : [];
    },
  );
  if (stalePaths.length > 0) {
    await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(stalePaths);
  }
};

export const signProfilePhotosForPayloads = async (
  supabase: SupabaseAdminClient,
  payloads: DatabaseRow[],
): Promise<DatabaseRow[]> => {
  const managedPaths = [
    ...new Set(
      payloads.flatMap((payload) =>
        sanitizePhotoList(
          payload.photos,
          typeof payload.id === "string" ? payload.id : undefined,
        )
          .map(getManagedStoragePath)
          .filter((path): path is string => Boolean(path))
      ),
    ),
  ];

  if (managedPaths.length === 0) {
    return payloads;
  }

  const signedUrlByPath = new Map<string, string>();
  const now = Date.now();
  const unsignedPaths = managedPaths.filter((path) => {
    const cached = signedProfilePhotoCache.get(path);
    if (!cached || cached.expiresAt <= now) {
      signedProfilePhotoCache.delete(path);
      return true;
    }

    signedProfilePhotoCache.delete(path);
    signedProfilePhotoCache.set(path, cached);
    signedUrlByPath.set(path, cached.signedUrl);
    return false;
  });

  if (unsignedPaths.length > 0) {
    const { data, error } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .createSignedUrls(unsignedPaths, PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS);

    if (error) {
      throw error;
    }

    (data ?? []).forEach(
      (item: { path?: string | null; signedUrl?: string | null }) => {
        if (item.path && item.signedUrl) {
          signedUrlByPath.set(item.path, item.signedUrl);
          signedProfilePhotoCache.set(item.path, {
            signedUrl: item.signedUrl,
            expiresAt: now + PROFILE_PHOTO_SIGNED_URL_CACHE_TTL_MS,
          });
        }
      },
    );

    while (
      signedProfilePhotoCache.size > MAX_PROFILE_PHOTO_SIGNED_URL_CACHE_ENTRIES
    ) {
      const oldestPath = signedProfilePhotoCache.keys().next().value as
        | string
        | undefined;
      if (!oldestPath) {
        break;
      }
      signedProfilePhotoCache.delete(oldestPath);
    }
  }

  if (signedUrlByPath.size !== managedPaths.length) {
    throw new Error("One or more profile photos could not be signed.");
  }

  return payloads.map((payload) => ({
    ...payload,
    photos: sanitizePhotoList(
      payload.photos,
      typeof payload.id === "string" ? payload.id : undefined,
    ).map((photo) => {
      const path = getManagedStoragePath(photo);
      return path ? signedUrlByPath.get(path) ?? photo : photo;
    }),
  }));
};

export const extractManagedProfilePhotoPaths = (
  photos: unknown,
  ownerUserId?: string,
) =>
  sanitizePhotoList(photos, ownerUserId)
    .map(getManagedStoragePath)
    .filter((path): path is string => Boolean(path));

export const cleanupRemovedManagedProfilePhotos = async (
  supabase: SupabaseAdminClient,
  ownerUserId: string,
  previousPhotos: unknown,
  nextPhotos: unknown,
) => {
  const previousPaths = extractManagedProfilePhotoPaths(
    previousPhotos,
    ownerUserId,
  );
  const nextPathSet = new Set(
    extractManagedProfilePhotoPaths(nextPhotos, ownerUserId),
  );
  const removedPaths = previousPaths.filter((path) => !nextPathSet.has(path));

  if (removedPaths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(
    removedPaths,
  );

  if (error) {
    console.error("Cleanup removed profile photos error:", error);
  }
};
