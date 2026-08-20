export const PUBLIC_WEB_BASE_URL = 'https://cayankuzu.github.io/WMatch_web';

function getAuthRedirectUrl(path: string, state?: string) {
  const baseUrl = `${PUBLIC_WEB_BASE_URL}${path}`;
  return state ? `${baseUrl}?state=${encodeURIComponent(state)}` : baseUrl;
}

export function getEmailVerificationRedirectUrl(state?: string) {
  return getAuthRedirectUrl('/auth/verify/', state);
}

export function getPasswordResetRedirectUrl(state?: string) {
  return getAuthRedirectUrl('/auth/reset-password/', state);
}

export function getPrivacyPolicyUrl() {
  return `${PUBLIC_WEB_BASE_URL}/privacy.html`;
}

export function getTermsOfUseUrl() {
  return `${PUBLIC_WEB_BASE_URL}/terms.html`;
}
