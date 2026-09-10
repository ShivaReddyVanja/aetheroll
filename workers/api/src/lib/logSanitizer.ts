/**
 * Redacts sensitive query parameters (such as session_token, secret, key, password)
 * from URLs and log messages to prevent credential leakage into server access logs.
 */
export function sanitizeLogMessage(message: string): string {
  if (!message || typeof message !== "string") return message;
  return message.replace(
    /([?&](?:session_token|token|secret|key|password|auth)=)[^&\s]+/gi,
    "$1[REDACTED]"
  );
}
