const RESERVED_PREFIXES = new Set([
  "api",
  "management-api",
  "setup-api",
  "recovery-api",
  "print-api",
  "webhooks",
  "health",
  "help",
  "legal",
  "media",
  "public",
  "handover",
  "carry-on",
  "restore-clock",
  "setup",
  "till",
  "assets",
]);

/** Classifies local dashboard pages; it grants no API access. */
export function isDashboardPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path))
    return false;
  const pathname = new URL(path, "https://waitron.invalid").pathname;
  if (/%2f|%5c|%00/i.test(pathname)) return false;
  const first = pathname.split("/")[1]!;
  return !first.includes(".") && !RESERVED_PREFIXES.has(first);
}
