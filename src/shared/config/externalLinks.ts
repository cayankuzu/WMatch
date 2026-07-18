export const TMDB_ATTRIBUTION_URL = 'https://www.themoviedb.org/';
export const LETTERBOXD_HOSTNAME = 'letterboxd.com';
export const LETTERBOXD_BASE_URL = `https://${LETTERBOXD_HOSTNAME}`;

export function getLetterboxdProfileUrl(rawValue: string): string | null {
  const cleanedValue = rawValue.trim();
  if (!cleanedValue) {
    return null;
  }

  const usernameCandidate = cleanedValue.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  const fallbackProfileUrl = usernameCandidate
    ? `${LETTERBOXD_BASE_URL}/${usernameCandidate}/`
    : null;

  try {
    const hasScheme = /^https?:\/\//i.test(cleanedValue);
    const hasDomain = new RegExp(`${LETTERBOXD_HOSTNAME.replace('.', '\\.')}($|/)`, 'i').test(cleanedValue);
    const candidateUrl = hasScheme
      ? cleanedValue
      : hasDomain
        ? `https://${cleanedValue}`
        : fallbackProfileUrl;

    if (!candidateUrl) {
      return null;
    }

    const parsedUrl = new URL(candidateUrl);
    const host = parsedUrl.hostname.toLowerCase();
    if (host !== LETTERBOXD_HOSTNAME && !host.endsWith(`.${LETTERBOXD_HOSTNAME}`)) {
      return fallbackProfileUrl;
    }

    const [profileSlug] = parsedUrl.pathname.split('/').filter(Boolean);
    return profileSlug ? `${LETTERBOXD_BASE_URL}/${profileSlug}/` : fallbackProfileUrl ?? `${LETTERBOXD_BASE_URL}/`;
  } catch {
    return fallbackProfileUrl;
  }
}

export function getLetterboxdDisplayText(profileUrl: string | null, missingLabel: string): string {
  if (!profileUrl) {
    return missingLabel;
  }

  const parsedUrl = new URL(profileUrl);
  const [profileSlug] = parsedUrl.pathname.split('/').filter(Boolean);
  return profileSlug ? `@${profileSlug}` : parsedUrl.hostname;
}
