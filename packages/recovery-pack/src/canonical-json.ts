/**
 * Keys sorted at every depth, no whitespace — the algorithm of the fiscal module's key file
 * (`packages/fiscal-verifactu/src/recovery-document.ts`, `recoveryDocumentBytes`), so a key file
 * nested in a pack keeps its own canonical bytes.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}
