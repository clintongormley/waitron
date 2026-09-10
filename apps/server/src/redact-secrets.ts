/**
 * The password of a connection string, masked, in the two positions the installed parser
 * (`pg-connection-string@2.14.0`, which `pg@8.22.0` resolves) actually reads one from:
 *
 *   `scheme://user:secret@host`              → `scheme://user:***@host`
 *   `scheme://user@host/db?password=secret`  → `?password=***`
 *
 * Each was fed to `parse()` and to `new Client({ connectionString })` and the marked value came back
 * as the password. The query one OVERRIDES the user-info one when both are present, which is why a
 * string carrying both has both masked.
 *
 * WHAT IT COVERS. The user-info rule models what `parse` does rather than guessing at a character
 * class, because two shapes it reads as passwords do not look like one: the authority ends at the
 * first `/`, `?` or `#` and then splits on the LAST `@`, so `postgres://u:p@ss@localhost/db` has the
 * password `p@ss`; and `parse` percent-encodes spaces before handing the string to `new URL`, so
 * `postgres://u:se cret@localhost/db` has the password `se cret`. The earlier character classes
 * stopped at both and left `ss` and `se cret` in the log. The user half is split off at the FIRST
 * `:` of the user-info, so an Azure-shaped `postgres://user@server:secret@host/db` masks the secret
 * and not the role name.
 *
 * WHAT IT DOES NOT COVER, and this list is not exhaustive: a password outside a URL — a libpq
 * `keyword=value` string (`host=… password=…`, space-separated; the query rule is anchored on `?`
 * or `&`, so it does not fire there), a `PGPASSWORD` in an environment dump, a `.pgpass` line — and
 * any other token, key or secret in any other shape. It is not a general secret scrubber and must
 * not be described as one. Two known blind spots inside its own scope: a password containing a
 * double quote is masked only up to that quote (`"` terminates both rules, because a log line is
 * JSON and an unescaped quote there is structure, never password text), and `password` is matched
 * case-sensitively because the parser reads it that way — `?PASSWORD=x` yields the empty string
 * from `parse()` and `null` from a `Client`, so it is not a credential position (measured; see
 * `redact-secrets.test.ts`).
 *
 * Faithful to the parser also means masking whatever the parser WOULD read as a password, including
 * in prose: `https://host:8080 and mail me@x.com` parses to the password `8080 and mail me`
 * (measured), so it is masked. Over-masking a line is the side the trade-off falls on, because the
 * text it protects reaches an unauthenticated page.
 *
 * WHERE IT IS APPLIED. Every line written to the box's rotating `waitron.log`
 * (`createRotatingFileSink`, `log-file.ts`), because the recovery page serves that file's tail to
 * anyone on the venue's LAN with no login; and the entrypoint's own boot-failure report
 * (`node-entry.ts`). The box's stdout is deliberately NOT filtered — see `boot.ts`, where the one
 * logger is tee'd to both.
 *
 * The user-info half is left visible: a role name is already in the box's own configuration and
 * naming it is what makes the line diagnosable, while the secret half is what must never be read
 * off a page or a terminal someone is screen-sharing.
 */

/** The authority of a URL: everything between `scheme://` and the first `/`, `?`, `#`, newline or
 * `"`. Deliberately ONE greedy class with nothing required after it, so the match is a single
 * linear scan and no log line — however adversarial — can make this backtrack; the sink calls it on
 * every line, including on a sale path. The `@` split is done in code below, not by the engine. */
const URL_AUTHORITY = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\r\n/?#"]*)/g;

/** A `password=` parameter in a URL's query. Anchored on `?`/`&` so it is a query POSITION, not the
 * word appearing in a sentence; the value runs to the next separator, and a space is not one. */
const URL_PASSWORD_PARAM = /([?&]password=)[^\r\n&#"]*/g;

function maskAuthority(match: string, scheme: string, authority: string): string {
  // The LAST `@`, as WHATWG URL parsing does it: everything before it is user-info.
  const at = authority.lastIndexOf("@");
  if (at < 0) return match;
  const userInfo = authority.slice(0, at);
  // The FIRST `:` splits user from password; without one there is no password position to mask.
  const colon = userInfo.indexOf(":");
  if (colon < 0) return match;
  return `${scheme}${userInfo.slice(0, colon)}:***${authority.slice(at)}`;
}

export function redactSecrets(text: string): string {
  return text.replace(URL_AUTHORITY, maskAuthority).replace(URL_PASSWORD_PARAM, "$1***");
}
