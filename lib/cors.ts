const ALLOWED_ORIGINS = new Set([
  "https://docs.google.com",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "https://portal.busybeeseniorcare.com",
]);

export function getAllowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;

  if (origin.startsWith("chrome-extension://")) {
    // TODO: Lock this down to the published extension ID after Chrome Web Store release.
    return origin;
  }

  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

export function buildCorsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = getAllowedCorsOrigin(origin);
  if (!allowedOrigin) return {};

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function buildPreflightCorsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = getAllowedCorsOrigin(origin);
  if (!allowedOrigin) return {};

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
