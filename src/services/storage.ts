import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { SUPABASE_URL, supabase } from '../../utils/supabase/client';

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';

const PUBLIC_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${PROFILE_PHOTOS_BUCKET}/`;
const SIGNED_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/sign/${PROFILE_PHOTOS_BUCKET}/`;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_CONCURRENCY = 2;
const PROFILE_PHOTO_RESIZE_WIDTH = 1200;
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(256);

for (let index = 0; index < BASE64_CHARS.length; index += 1) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(index)] = index;
}

function isRemotePhotoUrl(uri: string) {
  return /^https?:\/\//i.test(uri);
}

function isDataUri(uri: string) {
  return /^data:/i.test(uri);
}

function parseDataUri(uri: string) {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function getExtensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'image/jpg':
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

function getFileExtension(uri: string, mimeType?: string | null) {
  if (mimeType) {
    return getExtensionFromMimeType(mimeType);
  }

  const cleanUri = uri.split('?')[0];
  const match = cleanUri.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? 'jpg';
}

function getMimeType(extension: string) {
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

function isLocalPhotoUri(uri: string) {
  return !isRemotePhotoUrl(uri) && !isDataUri(uri);
}

function createStoragePath(userId: string, index: number, extension: string) {
  const suffix = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
  return `${userId}/${suffix}.${extension}`;
}

function getManagedStoragePath(photoUrl: string) {
  const prefix = photoUrl.startsWith(PUBLIC_URL_PREFIX)
    ? PUBLIC_URL_PREFIX
    : photoUrl.startsWith(SIGNED_URL_PREFIX)
      ? SIGNED_URL_PREFIX
      : null;

  if (!prefix) {
    return null;
  }

  const encodedPath = photoUrl.slice(prefix.length).split('?')[0];
  return decodeURIComponent(encodedPath);
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const record = error as Record<string, unknown>;
  const values = [record.error, record.message, record.details, record.hint]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  return values[0] ?? fallback;
}

function mapStorageError(error: unknown) {
  const message = extractErrorMessage(error, 'Profil fotoğrafı yüklenemedi.');

  if (/bucket/i.test(message) && /not found|does not exist/i.test(message)) {
    return new Error(
      `Profil fotoğrafları yüklenemedi. Supabase Storage içinde "${PROFILE_PHOTOS_BUCKET}" adında public bir bucket oluşturmalısın.`,
    );
  }

  if (/row-level security|policy/i.test(message)) {
    return new Error(
      `Profil fotoğrafları yüklenemedi. "${PROFILE_PHOTOS_BUCKET}" bucket'ı için storage policy ayarlarını tamamlamalısın.`,
    );
  }

  return new Error(message);
}

function decodeBase64ToArrayBuffer(base64: string) {
  const cleaned = base64.replace(/\s/g, '');
  let bufferLength = cleaned.length * 0.75;

  if (cleaned.endsWith('==')) {
    bufferLength -= 2;
  } else if (cleaned.endsWith('=')) {
    bufferLength -= 1;
  }

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arrayBuffer);

  let pointer = 0;
  for (let index = 0; index < cleaned.length; index += 4) {
    const encoded1 = BASE64_LOOKUP[cleaned.charCodeAt(index)];
    const encoded2 = BASE64_LOOKUP[cleaned.charCodeAt(index + 1)];
    const encoded3 = BASE64_LOOKUP[cleaned.charCodeAt(index + 2)];
    const encoded4 = BASE64_LOOKUP[cleaned.charCodeAt(index + 3)];

    bytes[pointer++] = (encoded1 << 2) | (encoded2 >> 4);

    if (cleaned[index + 2] !== '=') {
      bytes[pointer++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }

    if (cleaned[index + 3] !== '=') {
      bytes[pointer++] = ((encoded3 & 3) << 6) | encoded4;
    }
  }

  return arrayBuffer;
}

async function normalizeLocalPhotoUri(uri: string) {
  const normalized = await manipulateAsync(
    uri,
    [{ resize: { width: PROFILE_PHOTO_RESIZE_WIDTH } }],
    {
      compress: 0.82,
      format: SaveFormat.JPEG,
      base64: false,
    },
  );

  return normalized.uri;
}

async function getUploadPayload(photo: string) {
  if (isDataUri(photo)) {
    const parsed = parseDataUri(photo);
    if (!parsed) {
      throw new Error('Profil fotoğrafı verisi okunamadı.');
    }

    const extension = getFileExtension(photo, parsed.mimeType);

    const bytes = decodeBase64ToArrayBuffer(parsed.base64);

    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error('Profil fotoğrafı 5 MB sınırını aşıyor. Daha küçük bir fotoğraf seç.');
    }

    return {
      contentType: parsed.mimeType,
      extension,
      bytes,
    };
  }

  const uploadUri = isLocalPhotoUri(photo) ? await normalizeLocalPhotoUri(photo) : photo;
  const response = await fetch(uploadUri);

  if (!response.ok) {
    throw new Error('Profil fotoğrafı cihazdan okunamadı. Fotoğrafı tekrar seçmeni öneririz.');
  }

  const extension = isLocalPhotoUri(photo) ? 'jpg' : getFileExtension(photo);
  const bytes = await response.arrayBuffer();

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('Profil fotoğrafı 5 MB sınırını aşıyor. Daha küçük bir fotoğraf seç.');
  }

  return {
    contentType: getMimeType(extension),
    extension,
    bytes,
  };
}

async function uploadProfilePhoto(userId: string, photo: string, index: number) {
  const payload = await getUploadPayload(photo);
  const path = createStoragePath(userId, index, payload.extension);

  const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).upload(path, payload.bytes, {
    contentType: payload.contentType,
    upsert: false,
  });

  if (error) {
    throw mapStorageError(error);
  }

  const { data } = supabase.storage.from(PROFILE_PHOTOS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function deleteManagedPhotosByPaths(paths: string[]) {
  if (paths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(paths);
  if (error) {
    console.warn('Managed profile photos could not be cleaned up:', error);
  }
}

async function deleteRemovedManagedPhotos(previousPhotos: string[], nextPhotos: string[]) {
  const removedPaths = previousPhotos
    .filter((photo) => !nextPhotos.includes(photo))
    .map(getManagedStoragePath)
    .filter((path): path is string => Boolean(path));

  await deleteManagedPhotosByPaths(removedPaths);
}

export function hasLocalProfilePhotos(photos: string[]) {
  return photos.some((photo) => photo.trim().length > 0 && !isRemotePhotoUrl(photo));
}

export async function cleanupManagedProfilePhotos(photos: string[]) {
  const managedPaths = photos
    .map(getManagedStoragePath)
    .filter((path): path is string => Boolean(path));

  await deleteManagedPhotosByPaths(managedPaths);
}

export async function cleanupRemovedProfilePhotos(previousPhotos: string[], nextPhotos: string[]) {
  await deleteRemovedManagedPhotos(previousPhotos, nextPhotos);
}

export async function persistProfilePhotos({
  userId,
  photos,
  previousPhotos = [],
  cleanupRemoved = true,
}: {
  userId: string;
  photos: string[];
  previousPhotos?: string[];
  cleanupRemoved?: boolean;
}) {
  const normalizedPhotos = photos.map((photo) => photo.trim()).filter((photo) => photo.length > 0);
  const nextPhotos = new Array<string>(normalizedPhotos.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(MAX_UPLOAD_CONCURRENCY, normalizedPhotos.length) }, async () => {
      while (cursor < normalizedPhotos.length) {
        const index = cursor;
        cursor += 1;
        const photo = normalizedPhotos[index];

        if (isRemotePhotoUrl(photo)) {
          nextPhotos[index] = photo;
          continue;
        }

        nextPhotos[index] = await uploadProfilePhoto(userId, photo, index);
      }
    }),
  );

  if (cleanupRemoved) {
    await deleteRemovedManagedPhotos(previousPhotos, nextPhotos);
  }

  return nextPhotos;
}
