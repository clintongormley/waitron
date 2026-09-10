/**
 * The password of a connection string, masked, in the three positions the installed `pg` (8.22.0)
 * actually reads one from:
 *
 *   `scheme://user:secret@host`              → `scheme://user:***@host`
 *   `scheme://:secret@host`                  → `scheme://:***@host`   (the user half may be empty)
 *   `scheme://user@host/db?password=secret`  → `?password=***`
 *
 * Each was fed to `new Client({ connectionString })` and the marked value came back as
 * `connectionParameters.password`. The last OVERRIDES the user-info one when both are present, which
 * is why a string carrying both has both masked.
 *
 * DELIBERATELY NARROW, and this list is what it covers — nothing else. It does NOT cover a password
 * outside a URL: a libpq `keyword=value` string (`host=… password=…`, space-separated), a
 * `PGPASSWORD` in an environment dump, a `.pgpass` line, or any other token, key or secret in any
 * other shape. It is not a general secret scrubber and must not be described as one. `password` is
 * matched case-sensitively because `pg` reads it that way: `?PASSWORD=` parses to a null password
 * (measured), so it is not a credential position.
 *
 * The text it protects goes to the container's stdout (`docker logs`), the installer's channel,
 * never the unauthenticated recovery page. The page's protection is structural — it renders fixed
 * strings chosen by code (`recovery-surface.ts`), not this function's output.
 *
 * The user-info half is left visible: a role name is already in the box's own configuration and
 * naming it is what makes the line diagnosable, while the secret half is what must never be read
 * off a terminal someone is screen-sharing.
 */
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/?#@]*):[^\s@/]*@/g;

/** A `password=` parameter in a URL's query. Anchored on `?`/`&` so it is a query POSITION, not the
 * word appearing in a sentence; the value runs to the next separator. */
const URL_PASSWORD_PARAM = /([?&]password=)[^\s&#]*/g;

export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1:***@").replace(URL_PASSWORD_PARAM, "$1***");
}
