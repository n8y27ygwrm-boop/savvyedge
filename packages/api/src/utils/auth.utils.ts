import crypto from "crypto";

export interface AuthCheckResult {
  authorized: boolean;
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Server-only authorization verification helper.
 * Validates request headers against INTERNAL_API_SECRET.
 * Standardized responses:
 * - Missing INTERNAL_API_SECRET env var -> 503 (Security Configuration Error)
 * - Missing Authorization or X-API-Key header -> 401 (Unauthorized)
 * - Invalid or mismatching credential -> 403 (Forbidden)
 * - Valid credential matching secret -> Authorized
 */
export function verifyApiAuthorization(request: Request): AuthCheckResult {
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret || secret.trim() === "") {
    console.error(
      "[SECURITY CONFIG ERROR] INTERNAL_API_SECRET is missing or empty in server environment!"
    );
    return {
      authorized: false,
      statusCode: 503,
      errorMessage: "Service unavailable: Security configuration error",
    };
  }

  const authHeader = request.headers.get("authorization");
  const apiKeyHeader = request.headers.get("x-api-key");

  let providedToken: string | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    providedToken = authHeader.substring(7).trim();
  } else if (apiKeyHeader && apiKeyHeader.trim() !== "") {
    providedToken = apiKeyHeader.trim();
  }

  if (!providedToken) {
    return {
      authorized: false,
      statusCode: 401,
      errorMessage: "Unauthorized: Missing API credentials",
    };
  }

  const secretBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(providedToken);

  const isMatch =
    secretBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(secretBuffer, providedBuffer);

  if (!isMatch) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: "Forbidden: Invalid API credentials",
    };
  }

  return { authorized: true };
}
