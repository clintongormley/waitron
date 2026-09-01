export type ClientLogLevel = "debug" | "info" | "warn" | "error";
export type TrailField = string | number | boolean;
export interface TrailEvent {
  at: string;
  level: ClientLogLevel;
  event: string;
  fields: Record<string, TrailField>;
}
export interface DiagnosticsLog {
  record(level: ClientLogLevel, event: string, fields?: Record<string, unknown>): void;
  snapshot(): TrailEvent[];
}

const MAX_STRING = 300;
const MAX_FIELDS = 20;

/**
 * The ONLY way an event enters the trail. `redact` is the guarantee that a body can never reach the
 * buffer: a field is kept only if its value is a string / number / boolean, strings are truncated,
 * and the field count is capped. In `strict` mode (tests) a rejected field throws so the guard is
 * provable by deletion.
 */
function redact(
  fields: Record<string, unknown> | undefined,
  strict: boolean,
): Record<string, TrailField> {
  const out: Record<string, TrailField> = {};
  if (fields === undefined) return out;
  let count = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (count >= MAX_FIELDS) break;
    if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      count++;
      continue;
    }
    if (typeof v === "string") {
      out[k] = v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
      count++;
      continue;
    }
    if (strict) throw new Error(`diagnostics: non-primitive field "${k}" rejected`);
    // else: silently drop in production — never let a body through
  }
  return out;
}

export function createDiagnosticsLog(
  opts: { max?: number; now?: () => Date; strict?: boolean } = {},
): DiagnosticsLog {
  const max = opts.max ?? 200;
  const now = opts.now ?? (() => new Date());
  const strict = opts.strict ?? false;
  const buffer: TrailEvent[] = [];
  return {
    record(level, event, fields) {
      buffer.push({ at: now().toISOString(), level, event, fields: redact(fields, strict) });
      if (buffer.length > max) buffer.splice(0, buffer.length - max);
    },
    snapshot: () => buffer.map((e) => ({ ...e, fields: { ...e.fields } })),
  };
}
