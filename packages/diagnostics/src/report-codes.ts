// This catalog is browser-safe; unknown codes never carry the server's arbitrary text.
export const REPORT_CODES: ReadonlySet<string> = new Set([
  "authorization.not_permitted",
  "management_session.expired",
  "management_session.required",
  "password.invalid",
  "pin.invalid",
  "device.not_registered",
  "device.forbidden_action",
  "sale.voided",
  "server.internal",
  "storage.disk_full",
  "unknown",
]);

export function reportCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return REPORT_CODES.has(value) ? value : "unknown";
}
