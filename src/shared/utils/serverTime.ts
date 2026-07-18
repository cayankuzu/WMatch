type HeaderSource = Pick<Headers, 'get'> | null | undefined;

interface ServerTimeSnapshot {
  serverNowMs: number;
  monotonicNowMs: number;
  deviceNowMs: number;
}

let snapshot: ServerTimeSnapshot | null = null;

function getMonotonicNowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function parseServerTime(value: string | number | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function syncServerTime(value: string | number | Date | null | undefined) {
  const serverNowMs = parseServerTime(value);

  if (serverNowMs == null) {
    return false;
  }

  snapshot = {
    serverNowMs,
    monotonicNowMs: getMonotonicNowMs(),
    deviceNowMs: Date.now(),
  };

  return true;
}

export function syncServerTimeFromHeaders(headers: HeaderSource) {
  if (!headers) {
    return false;
  }

  return syncServerTime(headers.get('x-server-time') ?? headers.get('date'));
}

export function getServerNowMs() {
  if (!snapshot) {
    return Date.now();
  }

  const monotonicElapsed = getMonotonicNowMs() - snapshot.monotonicNowMs;

  if (Number.isFinite(monotonicElapsed) && monotonicElapsed >= 0) {
    return snapshot.serverNowMs + monotonicElapsed;
  }

  const deviceElapsed = Date.now() - snapshot.deviceNowMs;
  return snapshot.serverNowMs + Math.max(0, deviceElapsed);
}

export function getServerNowIsoString() {
  return new Date(getServerNowMs()).toISOString();
}
