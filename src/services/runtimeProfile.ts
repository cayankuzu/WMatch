import * as Device from 'expo-device';

export type RuntimeTier = 'constrained' | 'balanced' | 'high';

const GIGABYTE = 1024 * 1024 * 1024;

function resolveRuntimeTier(): RuntimeTier {
  const totalMemory = Device.totalMemory ?? 0;
  const deviceYearClass = Device.deviceYearClass ?? 0;

  if ((totalMemory > 0 && totalMemory < 3 * GIGABYTE) || (deviceYearClass > 0 && deviceYearClass <= 2018)) {
    return 'constrained';
  }

  if (totalMemory >= 6 * GIGABYTE && deviceYearClass >= 2021) {
    return 'high';
  }

  return 'balanced';
}

export const runtimeProfile = {
  tier: resolveRuntimeTier(),
  totalMemory: Device.totalMemory,
  deviceYearClass: Device.deviceYearClass,
} as const;

export function getResidentTabLimit() {
  return runtimeProfile.tier === 'constrained' ? 2 : runtimeProfile.tier === 'high' ? 4 : 3;
}

export function getLaunchTaskConcurrency() {
  return runtimeProfile.tier === 'constrained' ? 1 : runtimeProfile.tier === 'high' ? 3 : 2;
}

export function getMediaPrefetchConcurrency() {
  return runtimeProfile.tier === 'constrained' ? 1 : runtimeProfile.tier === 'high' ? 4 : 3;
}

export function getMediaQueueLimit() {
  return runtimeProfile.tier === 'constrained' ? 20 : runtimeProfile.tier === 'high' ? 64 : 40;
}
