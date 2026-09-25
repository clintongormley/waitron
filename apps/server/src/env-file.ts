/**
 * Dependency-free on purpose: imported by both the production bundle and dev tooling.
 * `scripts/dev-server.mjs` keeps its OWN copy of the parser, as plain `.mjs` that cannot import `.ts`.
 */

/**
 * Parse the `KEY=value` lines of an env file, splitting on the FIRST `=` so a value's own `=` (a base64
 * pad) survives. Blank lines, `#` comment lines and lines with no `=` are skipped.
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

/** Build an env-file body: one `KEY=value\n` line per entry, in insertion order, values verbatim. */
export function formatEnvFile(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}
