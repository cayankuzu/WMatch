import { theme } from './index';

function toCompatibilityStyle(tier: (typeof theme.compatibility)[keyof typeof theme.compatibility]) {
  return {
    color: tier.color,
    borderColor: tier.border,
    bg: tier.surface,
    track: tier.track,
  };
}

export function getCompatibilityStyle(score: number) {
  if (score >= 85) {
    return toCompatibilityStyle(theme.compatibility.excellent);
  }

  if (score >= 70) {
    return toCompatibilityStyle(theme.compatibility.strong);
  }

  if (score >= 55) {
    return toCompatibilityStyle(theme.compatibility.good);
  }

  if (score >= 35) {
    return toCompatibilityStyle(theme.compatibility.developing);
  }

  return toCompatibilityStyle(theme.compatibility.limited);
}
