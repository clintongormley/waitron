/**
 * The one place `KEY=value` env files are parsed and formatted. Dependency-free on purpose: it is
 * imported both by `boot.ts` (on the production bundle graph, to read the box's `secrets.env` back)
 * and by `scripts/dev-setup.ts` (dev tooling, NOT on that graph), so it must pull in nothing either
 * side would object to. `scripts/dev-server.mjs` keeps its OWN copy of the parser — it is plain
 * `.mjs` and cannot import this `.ts`.
 */

/**
 * Parse the `KEY=value` lines of an env file into a record, splitting on the FIRST `=` so a value's
 * own `=` survives (a base64 pad — `WAITRON_CREDENTIALS_KEY` is base64 — or a URI query string).
 * Blank lines and `#` comment lines are skipped, and a line with no `=` at all is ignored. Pure.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/**
 * Build an env-file body from a record: one `KEY=value\n` line per entry, in insertion order, each
 * LF-terminated. The inverse shape of `parseEnvFile` for the values it round-trips, and the shared
 * body of the hand-built `secrets.env`/`trading.env` writers (`box-secrets.ts`, `trading-config.ts`).
 * Values are emitted verbatim — callers `String(...)` any non-string field first. Pure.
 */
export function formatEnvFile(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}
