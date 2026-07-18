export const PUBLIC_WEB_BASE_URL = 'https://cayankuzu.github.io/WMatch_web';

export function getEmailVerificationRedirectUrl() {
  return `${PUBLIC_WEB_BASE_URL}/auth/verify/`;
}

export function getPasswordResetRedirectUrl() {
  return `${PUBLIC_WEB_BASE_URL}/auth/reset-password/`;
}

export function getPrivacyPolicyUrl() {
  return `${PUBLIC_WEB_BASE_URL}/privacy.html`;
}

export function getTermsOfUseUrl() {
  return `${PUBLIC_WEB_BASE_URL}/terms.html`;
}
