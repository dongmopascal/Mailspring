// A 5xx SMTP response ("550 no such user", "553 mailbox unavailable", ...) is
// a permanent rejection: retrying will never succeed, so it should bounce
// immediately instead of burning through the retry budget. A 4xx response
// (mailbox full, greylisting, ...) is transient and keeps the normal
// retry/backoff behavior.
export function isPermanentFailure(error) {
  const code = error?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}
