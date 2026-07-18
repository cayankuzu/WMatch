import * as Sentry from '@sentry/react-native';

type TelemetryProperties = Record<string, unknown>;

type TelemetrySpan = {
  end: (properties?: TelemetryProperties) => void;
};

const SENSITIVE_KEY_PATTERN = /(authorization|email|lat|latitude|lng|longitude|message|password|photo|secret|token|url)/i;
const SENSITIVE_TEXT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bBearer\s+[A-Z0-9._~+/=-]+/gi,
  /https?:\/\/\S+/gi,
];
let telemetryEnabled = false;
const appModuleStartedAt = Date.now();
const startupMilestones = new Set<string>();

function sanitizeText(value: string) {
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (safeValue, pattern) => safeValue.replace(pattern, '<redacted>'),
    value,
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (typeof value === 'string') {
    return sanitizeText(value);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as TelemetryProperties).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '<redacted>' : sanitizeValue(nestedValue),
    ]),
  );
}

function sanitizeProperties(properties?: TelemetryProperties) {
  return properties ? (sanitizeValue(properties) as TelemetryProperties) : undefined;
}

function normalizeSampleRate(value: string | undefined) {
  const parsed = Number(value ?? '0.05');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.05;
}

export function initializeTelemetry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  telemetryEnabled = Boolean(dsn);

  Sentry.init({
    dsn,
    enabled: telemetryEnabled,
    environment: process.env.EXPO_PUBLIC_APP_ENV?.trim() || (__DEV__ ? 'development' : 'production'),
    tracesSampleRate: normalizeSampleRate(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
    sendDefaultPii: false,
    attachStacktrace: true,
    enableAutoSessionTracking: true,
    debug: false,
  });
}

export const telemetry = {
  captureException(error: unknown, context?: TelemetryProperties) {
    const safeContext = sanitizeProperties(context);
    const sourceError = error instanceof Error ? error : new Error(String(error));
    const safeError = new Error(sanitizeText(sourceError.message));
    safeError.name = sourceError.name;
    safeError.stack = sourceError.stack ? sanitizeText(sourceError.stack) : safeError.stack;

    if (telemetryEnabled) {
      Sentry.withScope((scope) => {
        if (safeContext) {
          scope.setContext('wmatch', safeContext);
        }
        Sentry.captureException(safeError);
      });
    } else if (__DEV__) {
      console.error('Telemetry exception', safeError, safeContext);
    }
  },

  track(event: string, properties?: TelemetryProperties) {
    const safeProperties = sanitizeProperties(properties);
    if (telemetryEnabled) {
      Sentry.addBreadcrumb({
        category: 'wmatch',
        message: event,
        data: safeProperties,
        level: 'info',
      });
    } else if (__DEV__) {
      console.info('Telemetry event', event, safeProperties);
    }
  },

  startSpan(name: string): TelemetrySpan {
    const startedAt = Date.now();

    return {
      end(properties?: TelemetryProperties) {
        telemetry.track(name, {
          ...properties,
          durationMs: Date.now() - startedAt,
        });
      },
    };
  },

  markStartupMilestone(name: string, properties?: TelemetryProperties) {
    if (startupMilestones.has(name)) {
      return;
    }

    startupMilestones.add(name);
    telemetry.track(`app.startup.${name}`, {
      ...properties,
      elapsedMs: Date.now() - appModuleStartedAt,
    });
  },

  setUser(safeUserRef: string | null) {
    if (telemetryEnabled) {
      Sentry.setUser(safeUserRef ? { id: safeUserRef } : null);
    }
  },

  setRelease(version: string, build: string) {
    if (telemetryEnabled) {
      Sentry.setTag('app.version', version);
      Sentry.setTag('app.build', build);
    }
  },
};
