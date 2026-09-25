/**
 * The password of a URL, masked, in the two positions `pg`'s connection-string parser reads one
 * from (measured with `pg-connection-string@2.14.0`):
 *
 *   `scheme://user:secret@host`              → `scheme://user:***@host`
 *   `scheme://user@host/db?password=secret`  → `?password=***`
 *
 * A string carrying both has both masked. The authority ends at the first `/`, `?`, `#`, newline or
 * `"` and splits on the LAST `@`, so `postgres://u:p@ss@localhost/db` masks `p@ss`, and a space
 * does not end a password. The user half is split off at the FIRST `:` of the user-info, so
 * `postgres://user@server:secret@host/db` masks the secret and not the role name.
 *
 * It is not a general secret scrubber and must not be described as one: a password outside a URL
 * (a `keyword=value` string, an environment dump) and any other token, key or secret pass through.
 * Two known blind spots inside its own scope: a password containing a double quote is not masked
 * when the `@` falls after that quote (a log line is JSON, where an unescaped quote is structure,
 * never password text), and `password` is matched case-sensitively.
 *
 * It masks whatever falls in a password position, including in prose: `https://host:8080 and mail
 * me@x.com` masks `8080 and mail me`. Over-masking is the side the trade-off falls on, because the
 * text it protects reaches an unauthenticated page.
 *
 * WHERE IT IS APPLIED. Every line written to the box's rotating `waitron.log`
 * (`createRotatingFileSink`, `log-file.ts`), because the recovery page serves that file's tail to
 * anyone on the venue's LAN with no login; and the entrypoint's own boot-failure report
 * (`node-entry.ts`). The box's stdout is deliberately NOT filtered — see `boot.ts`.
 *
 * The user-info half is left visible: naming the role is what makes the line diagnosable.
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
