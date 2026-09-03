const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 500;

export async function waitForHealth(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(2_000, intervalMs * 3)) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`health_status_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Health check timed out for ${url}: ${lastError instanceof Error ? lastError.message : 'unknown'}`);
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('Usage: node wait-for-health.mjs <url> [url...]');
    process.exitCode = 2;
  } else {
    try {
      await Promise.all(urls.map((url) => waitForHealth(url)));
      process.stdout.write(`Healthy: ${urls.join(', ')}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

