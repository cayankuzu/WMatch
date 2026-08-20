const encodeCursor = (value: Record<string, string | number>) =>
  btoa(JSON.stringify(value));

const decodeCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return null;
  }

  try {
    return JSON.parse(atob(cursor)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(new Date(value).getTime());

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

export const encodeMessageCursor = (message: {
  created_at?: string | null;
  id?: string | null;
}) =>
  message.created_at && message.id
    ? encodeCursor({ createdAt: message.created_at, id: message.id })
    : null;

export const decodeMessageCursor = (cursor: string | null | undefined) => {
  const parsed = decodeCursor(cursor);

  return parsed && isIsoDate(parsed.createdAt) && isId(parsed.id)
    ? { createdAt: parsed.createdAt, id: parsed.id }
    : null;
};

export const encodeLiveNowCursor = (row: {
  updated_at?: string | null;
  user_id?: string | null;
}) =>
  row.updated_at && row.user_id
    ? encodeCursor({ updatedAt: row.updated_at, userId: row.user_id })
    : null;

export const decodeLiveNowCursor = (cursor: string | null | undefined) => {
  const parsed = decodeCursor(cursor);

  return parsed && isIsoDate(parsed.updatedAt) && isId(parsed.userId)
    ? { updatedAt: parsed.updatedAt, userId: parsed.userId }
    : null;
};

export const encodeChatDirectoryCursor = (row: {
  activity_at?: string | null;
  other_user_id?: string | null;
}) =>
  row.activity_at && row.other_user_id
    ? encodeCursor({ activityAt: row.activity_at, userId: row.other_user_id })
    : null;

export const decodeChatDirectoryCursor = (cursor: string | null | undefined) => {
  const parsed = decodeCursor(cursor);

  return parsed && isIsoDate(parsed.activityAt) && isUuid(parsed.userId)
    ? { activityAt: parsed.activityAt, userId: parsed.userId }
    : null;
};

export const encodeCompatibilityCursor = (row: {
  compatibility_score?: number | string | null;
  user_id?: string | null;
}) => {
  const score = Number(row.compatibility_score);

  return Number.isSafeInteger(score) && score > 0 && score <= 100 && row.user_id
    ? encodeCursor({ score, userId: row.user_id })
    : null;
};

export const decodeCompatibilityCursor = (cursor: string | null | undefined) => {
  const parsed = decodeCursor(cursor);

  return parsed &&
      typeof parsed.score === "number" &&
      Number.isSafeInteger(parsed.score) &&
      parsed.score > 0 &&
      parsed.score <= 100 &&
      isUuid(parsed.userId)
    ? { score: parsed.score, userId: parsed.userId }
    : null;
};
