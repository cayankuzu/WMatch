import { ContractViolationError } from './errors';

export function assertObjectPayload<T extends Record<string, unknown>>(
  payload: unknown,
  requestId: string | null,
  path: string,
): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ContractViolationError(`Invalid response payload for ${path}`, requestId);
  }

  return payload as T;
}

export function assertArrayField<T>(
  payload: Record<string, unknown>,
  field: string,
  requestId: string | null,
  path: string,
  validator?: (value: unknown) => value is T,
): T[] {
  const value = payload[field];

  if (!Array.isArray(value)) {
    throw new ContractViolationError(`Missing array field "${field}" in ${path}`, requestId);
  }

  const invalidIndex = validator ? value.findIndex((item) => !validator(item)) : -1;
  if (invalidIndex >= 0) {
    throw new ContractViolationError(`Invalid item at "${field}[${invalidIndex}]" in ${path}`, requestId);
  }

  return value as T[];
}

export function assertValidatedPayload<T>(
  value: unknown,
  validator: (candidate: unknown) => candidate is T,
  requestId: string | null,
  path: string,
): T {
  if (!validator(value)) {
    throw new ContractViolationError(`Invalid domain payload for ${path}`, requestId);
  }

  return value;
}
