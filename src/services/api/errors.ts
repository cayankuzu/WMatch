export type ApiErrorCode =
  | 'HTTP_ERROR'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'SESSION_EXPIRED'
  | 'CONTRACT_VIOLATION';

export interface ApiRequestErrorOptions {
  status?: number;
  message: string;
  code?: ApiErrorCode;
  requestId?: string | null;
  retryable?: boolean;
  userMessageKey?: string;
  cause?: unknown;
}

function getDefaultUserMessageKey(code: ApiErrorCode, status: number) {
  if (code === 'NETWORK_UNAVAILABLE') return 'data.error.network';
  if (code === 'REQUEST_TIMEOUT') return 'data.error.timeout';
  if (code === 'SESSION_EXPIRED' || status === 401 || status === 403) return 'data.error.sessionExpired';
  if (code === 'CONTRACT_VIOLATION') return 'data.error.contract';
  return status === 429 || status >= 500 ? 'data.error.server' : 'data.error.generic';
}

export class ApiRequestError extends Error {
  status: number;
  code: ApiErrorCode;
  requestId: string | null;
  retryable: boolean;
  userMessageKey: string;
  cause?: unknown;

  constructor({
    status = 0,
    message,
    code = 'HTTP_ERROR',
    requestId = null,
    retryable,
    userMessageKey,
    cause,
  }: ApiRequestErrorOptions) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable ?? (status >= 500 || code === 'NETWORK_UNAVAILABLE' || code === 'REQUEST_TIMEOUT');
    this.userMessageKey = userMessageKey ?? getDefaultUserMessageKey(code, status);
    this.cause = cause;
  }
}

export class NetworkUnavailableError extends ApiRequestError {
  constructor(message: string, requestId: string, cause?: unknown) {
    super({ message, code: 'NETWORK_UNAVAILABLE', requestId, retryable: true, userMessageKey: 'data.error.network', cause });
    this.name = 'NetworkUnavailableError';
  }
}

export class RequestTimeoutError extends ApiRequestError {
  constructor(message: string, requestId: string, cause?: unknown) {
    super({ message, code: 'REQUEST_TIMEOUT', requestId, retryable: true, userMessageKey: 'data.error.timeout', cause });
    this.name = 'RequestTimeoutError';
  }
}

export class SessionExpiredError extends ApiRequestError {
  constructor(message: string, requestId: string | null, cause?: unknown) {
    super({ status: 401, message, code: 'SESSION_EXPIRED', requestId, retryable: false, userMessageKey: 'data.error.sessionExpired', cause });
    this.name = 'SessionExpiredError';
  }
}

export class ContractViolationError extends ApiRequestError {
  constructor(message: string, requestId: string | null, cause?: unknown) {
    super({ status: 502, message, code: 'CONTRACT_VIOLATION', requestId, retryable: false, userMessageKey: 'data.error.contract', cause });
    this.name = 'ContractViolationError';
  }
}
