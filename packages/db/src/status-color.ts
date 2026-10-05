const STATUS_COLOR_RE = /^[#A-Za-z0-9_-]{1,32}$/;

/** A table service status colour: a hex (`#ef4444`) or a short token (`amber`). The till paints it
 * into a `style` attribute, so a save and an import both refuse anything else. */
export function isStatusColor(value: unknown): value is string {
  return typeof value === "string" && STATUS_COLOR_RE.test(value);
}
