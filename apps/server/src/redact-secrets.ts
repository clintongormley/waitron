/**
 * Credentials embedded in a URL, masked: `scheme://user:secret@host` → `scheme://user:***@host`.
 *
 * DELIBERATELY NARROW. It masks the one leak the entrypoint's existing comments name — a `pg`
 * connection failure whose message carries the connection string it was built from
 * (`node-entry.ts`'s `waitForPostgres`) — and it makes no claim to scrub anything else. It is not a
 * general secret scrubber and must not be described as one: the text it protects goes to the
 * container's stdout (`docker logs`), which is the installer's channel, never the unauthenticated
 * recovery page. The page's protection is structural — it renders fixed strings chosen by code
 * (`recovery-surface.ts`), not this function's output.
 *
 * The user-info half is left visible: a role name is already in the box's own configuration and
 * naming it is what makes the line diagnosable, while the secret half is what must never be read
 * off a terminal someone is screen-sharing.
 */
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/?#@]+):[^\s@/]*@/g;

export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1:***@");
}
