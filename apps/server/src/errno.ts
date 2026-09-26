/** Only an errno-shaped code, such as `EPERM` or Node's `ERR_FS_EISDIR` — never a path or message. */
export function errnoOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && /^E[A-Z0-9_]+$/.test(code) ? code : undefined;
}
