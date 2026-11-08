const SENSITIVE_KEYS = /password|token|secret|authorization|cookie|otp|api[-_]?key/i;

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) =>
    [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(nested)]));
}

export function logEvent(event, details = {}) {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...redact(details) }));
}

export function createRequestMetrics() {
  const metrics = { requests: 0, failures: 0, totalDurationMs: 0 };
  return {
    middleware(req, res, next) {
      const started = process.hrtime.bigint();
      metrics.requests += 1;
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        metrics.totalDurationMs += durationMs;
        if (res.statusCode >= 500) metrics.failures += 1;
        logEvent('http_request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs)
        });
      });
      next();
    },
    snapshot() {
      return {
        ...metrics,
        averageDurationMs: metrics.requests ? Math.round(metrics.totalDurationMs / metrics.requests) : 0
      };
    }
  };
}
