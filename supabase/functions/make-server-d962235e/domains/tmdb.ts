import {
  app,
  buildAbuseKey,
  enforceRateLimit,
  getErrorMessage,
  getRequestRateLimitIdentity,
  getSupabase,
} from "../runtime.ts";

const MAX_TMDB_PROXY_REQUESTS_PER_MINUTE = 120;
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_PROXY_CACHE_TTL_MS = 30 * 60 * 1000;
const TMDB_PROXY_MAX_CACHE_ENTRIES = 300;
const tmdbProxyCache = new Map<string, { payload: unknown; expiresAt: number }>();
const tmdbProxyInflight = new Map<string, Promise<unknown>>();
const isAllowedTmdbProxyPath = (path: string, query: URLSearchParams) => {
  if (path === "/trending/all/week" || path === "/movie/popular" || path === "/tv/popular") {
    return true;
  }

  if (/^\/search\/(multi|movie|tv)$/.test(path)) {
    const searchQuery = query.get("query")?.trim() ?? "";
    return searchQuery.length > 0 && searchQuery.length <= 80;
  }

  return /^\/(movie|tv)\/\d+$/.test(path) || /^\/(movie|tv)\/\d+\/translations$/.test(path);
};

const normalizeTmdbProxyPath = (requestUrl: string) => {
  const parsedUrl = new URL(requestUrl);
  const proxyPrefix = "/make-server-d962235e/tmdb";
  const path = parsedUrl.pathname.startsWith(proxyPrefix)
    ? parsedUrl.pathname.slice(proxyPrefix.length) || "/"
    : "/";

  parsedUrl.searchParams.delete("api_key");
  parsedUrl.searchParams.delete("append_to_response");

  return {
    path,
    query: parsedUrl.searchParams,
  };
};

const pruneTmdbProxyCache = () => {
  while (tmdbProxyCache.size > TMDB_PROXY_MAX_CACHE_ENTRIES) {
    const oldestKey = tmdbProxyCache.keys().next().value;

    if (!oldestKey) {
      break;
    }

    tmdbProxyCache.delete(oldestKey);
  }
};

const fetchTmdbProxyPayload = async (cacheKey: string, path: string, query: URLSearchParams) => {
  const cached = tmdbProxyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    tmdbProxyCache.delete(cacheKey);
    tmdbProxyCache.set(cacheKey, cached);
    return cached.payload;
  }

  if (cached) {
    tmdbProxyCache.delete(cacheKey);
  }

  const inflight = tmdbProxyInflight.get(cacheKey);

  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const apiKey = Deno.env.get("TMDB_API_KEY")?.trim();

    if (!apiKey) {
      throw new Error("TMDB_API_KEY is not configured.");
    }

    const upstreamQuery = new URLSearchParams(query);
    upstreamQuery.set("api_key", apiKey);

    const response = await fetch(`${TMDB_BASE_URL}${path}?${upstreamQuery.toString()}`, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`TMDB upstream request failed with status ${response.status}`);
    }

    const payload = await response.json();
    tmdbProxyCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + TMDB_PROXY_CACHE_TTL_MS,
    });
    pruneTmdbProxyCache();

    return payload;
  })().finally(() => {
    tmdbProxyInflight.delete(cacheKey);
  });

  tmdbProxyInflight.set(cacheKey, request);
  return request;
};

const getTmdbProxyErrorCode = (error: unknown) => {
  const message = getErrorMessage(error, "unknown");

  if (message.includes("TMDB_API_KEY is not configured")) {
    return "TMDB_KEY_MISSING";
  }

  const statusMatch = message.match(/status\s+(\d{3})/i);

  if (statusMatch) {
    return `TMDB_UPSTREAM_${statusMatch[1]}`;
  }

  return "TMDB_PROXY_FAILED";
};

export const TMDB_ROUTES = [
  { method: "POST", path: "/make-server-d962235e/tmdb/media-batch", domain: "tmdb" },
  { method: "GET", path: "/make-server-d962235e/tmdb/*", domain: "tmdb" },
] as const;

export const registerTmdbRoutes = () => {
  app.post("/make-server-d962235e/tmdb/media-batch", async (c) => {
    try {
      const body = await c.req.json().catch(() => null) as {
        refs?: Array<{ id?: unknown; mediaType?: unknown }>;
      } | null;
      const refs = Array.isArray(body?.refs)
        ? body.refs
            .filter((ref) => Number.isInteger(ref.id) && Number(ref.id) > 0 && (ref.mediaType === "movie" || ref.mediaType === "tv"))
            .map((ref) => ({ id: Number(ref.id), mediaType: ref.mediaType as "movie" | "tv" }))
        : [];
      const uniqueRefs = [...new Map(refs.map((ref) => [`${ref.mediaType}:${ref.id}`, ref])).values()].slice(0, 16);

      if (uniqueRefs.length === 0) {
        return c.json({ error: "En az bir geçerli içerik seçilmelidir." }, 400);
      }

      const supabase = getSupabase();
      const rateLimit = await enforceRateLimit(supabase, {
        action: "tmdb_media_batch",
        key: buildAbuseKey([getRequestRateLimitIdentity(c), "media-batch"]),
        limit: MAX_TMDB_PROXY_REQUESTS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json({ error: "Çok fazla istek gönderdin. Lütfen biraz bekle.", retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
      }

      const items = await Promise.all(uniqueRefs.map(async (ref) => {
        const path = `/${ref.mediaType}/${ref.id}`;
        const query = new URLSearchParams({ language: "tr-TR" });

        try {
          const payload = await fetchTmdbProxyPayload(`${path}?${query.toString()}`, path, query);
          return { ...ref, payload };
        } catch {
          return { ...ref, payload: null };
        }
      }));

      return c.json({ items });
    } catch (error) {
      const code = getTmdbProxyErrorCode(error);
      console.error("TMDB batch error:", { code, message: getErrorMessage(error, "unknown") });
      return c.json({ error: "Film servisi geçici olarak kullanılamıyor.", code }, 502);
    }
  });

  app.get("/make-server-d962235e/tmdb/*", async (c) => {
    try {
      const { path, query } = normalizeTmdbProxyPath(c.req.url);

      if (!isAllowedTmdbProxyPath(path, query)) {
        return c.json({ error: "İstenen film servisi yolu desteklenmiyor." }, 400);
      }

      const supabase = getSupabase();
      const rateLimit = await enforceRateLimit(supabase, {
        action: "tmdb_proxy",
        key: buildAbuseKey([getRequestRateLimitIdentity(c), path]),
        limit: MAX_TMDB_PROXY_REQUESTS_PER_MINUTE,
        windowSeconds: 60,
      });

      if (!rateLimit.allowed) {
        return c.json(
          {
          error: "Çok fazla istek gönderdin. Lütfen biraz bekle.",
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          },
          429,
        );
      }

      const cacheKey = `${path}?${query.toString()}`;
      const payload = await fetchTmdbProxyPayload(cacheKey, path, query);

      return c.json(payload);
    } catch (error) {
      const code = getTmdbProxyErrorCode(error);
      console.error("TMDB proxy error:", { code, message: getErrorMessage(error, "unknown") });
      return c.json({ error: "Film servisi geçici olarak kullanılamıyor.", code }, 502);
    }
  });
};
