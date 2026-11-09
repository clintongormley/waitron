import { isUuid } from "@waitron/shared";
import type { TrailEvent, TrailField } from "./log.js";
import { maskPath } from "./instrument-fetch.js";
import { reportCode } from "./report-codes.js";
import { reportDescriptionValid } from "./report-description.js";

export interface ClientReportEnvironment {
  build: string | null;
  locale: "en" | "es";
  theme: "light" | "dark";
  viewport: { width: number; height: number };
  online: boolean;
  browser: "chromium" | "firefox" | "safari" | "other";
}
export interface ClientReportSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly app: "dashboard" | "till" | "setup";
  readonly openedAt: string;
  readonly trail: readonly TrailEvent[];
  readonly client: ClientReportEnvironment;
  readonly truncated: boolean;
}
const KEYS: Record<string, readonly string[]> = {
  api: ["phase", "method", "path", "requestId", "status", "code", "error"],
  nav: [],
  "window.error": ["name", "code"],
  "window.unhandledrejection": ["name", "code"],
  "alerts.load_failed": ["code"],
  "disk_stop.load_failed": ["code"],
  "theme.load_failed": ["code"],
  "server-switch": [],
};
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);
function field(key: string, value: TrailField | undefined): TrailField | undefined {
  switch (key) {
    case "phase":
      return value === "start" || value === "end" ? value : undefined;
    case "method":
      return typeof value === "string" && METHODS.has(value) ? value : undefined;
    case "path":
      return typeof value === "string" ? maskPath(value).slice(0, 300) : undefined;
    case "requestId":
      return typeof value === "string" && isUuid(value) && value === value.toLowerCase()
        ? value
        : undefined;
    case "status":
      return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
        ? value
        : undefined;
    case "code":
      return reportCode(value);
    case "error":
      return value === "network" ? value : undefined;
    case "name":
      return typeof value === "string" && NAMES.has(value) ? value : undefined;
    default:
      return undefined;
  }
}
function project(event: TrailEvent, end: number): TrailEvent | undefined {
  const at = Date.parse(event.at);
  if (
    !Number.isFinite(at) ||
    at > end ||
    at < end - 900_000 ||
    !Object.hasOwn(KEYS, event.event) ||
    !["debug", "info", "warn", "error"].includes(event.level)
  )
    return;
  const fields: Record<string, TrailField> = {};
  for (const key of KEYS[event.event]!) {
    const value = field(key, event.fields[key]);
    if (value !== undefined) fields[key] = value;
  }
  return Object.freeze({
    at: new Date(at).toISOString(),
    level: event.level,
    event: event.event,
    fields: Object.freeze(fields),
  });
}
const dimension = (value: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(10000, Math.trunc(value))) : 1;
function environment(client: ClientReportEnvironment): ClientReportEnvironment {
  return Object.freeze({
    build:
      typeof client.build === "string" &&
      client.build.length <= 64 &&
      /^(?:development|[a-f0-9]{7,64}|v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.test(client.build)
        ? client.build
        : null,
    locale: client.locale === "es" ? "es" : "en",
    theme: client.theme === "dark" ? "dark" : "light",
    viewport: Object.freeze({
      width: dimension(client.viewport.width),
      height: dimension(client.viewport.height),
    }),
    online: client.online === true,
    browser: ["chromium", "firefox", "safari"].includes(client.browser) ? client.browser : "other",
  });
}
export function captureClientReport({
  app,
  trail,
  client,
  now = new Date(),
  makeId = () => crypto.randomUUID(),
}: {
  app: ClientReportSnapshot["app"];
  trail: readonly TrailEvent[];
  client: ClientReportEnvironment;
  now?: Date;
  makeId?: () => string;
}): ClientReportSnapshot {
  const openedAt = now.toISOString(),
    rows: TrailEvent[] = [],
    ids = new Set<string>(),
    encoder = new TextEncoder();
  let size = 2,
    truncated = false;
  for (let i = trail.length - 1; i >= 0; i--) {
    const row = project(trail[i]!, +now);
    if (!row) {
      truncated = true;
      continue;
    }
    const id = row.fields.requestId;
    const bytes = encoder.encode(JSON.stringify(row)).byteLength + (rows.length ? 1 : 0);
    if (
      rows.length === 200 ||
      size + bytes > 65536 ||
      (typeof id === "string" && !ids.has(id) && ids.size === 100)
    ) {
      truncated = true;
      continue;
    }
    if (typeof id === "string") ids.add(id);
    size += bytes;
    rows.push(row);
  }
  return Object.freeze({
    version: 1,
    id: makeId(),
    app,
    openedAt,
    trail: Object.freeze(rows.reverse()),
    client: environment(client),
    truncated,
  });
}
export function renderClientReport(
  base: ClientReportSnapshot,
  description: string,
): { name: string; text: string } | undefined {
  if (!reportDescriptionValid(description)) return;
  const json = JSON.stringify({ ...base, description }, null, 2).replace(
    /[<>&`\u202a-\u202e\u2066-\u2069]/gu,
    (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  return {
    name: `problem-report-${base.id}.md`,
    text: "# Problem report\n\n```json\n" + json + "\n```\n",
  };
}
