import { t as tKit } from "@waitron/dashboard-kit";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { AlertView, DashboardApi } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";

const INCIDENT_PREFIX = "incident:";

export function incidentIdOf(alert: Pick<AlertView, "key" | "kind">): string | null {
  return alert.kind === "event" && alert.key.startsWith(INCIDENT_PREFIX)
    ? alert.key.slice(INCIDENT_PREFIX.length)
    : null;
}

/** The screen a "Go to" action opens. */
export function screenTargetOf(
  alert: Pick<AlertView, "kind" | "screen">,
  canOpen: (screen: string) => boolean,
): string | null {
  return alert.screen !== undefined && canOpen(alert.screen) ? alert.screen : null;
}

/** Invalidates rather than re-watching: while another observer (the bell or the Alerts screen) holds
 * the same query, its shared entry survives a release un-dirtied, so a re-watch is handed the cached
 * value. */
export async function markAlertHandled(
  api: Pick<DashboardApi, "markIncidentHandled" | "liveData">,
  incidentId: string,
  stillCurrent: () => boolean = () => true,
): Promise<void> {
  await api.markIncidentHandled(incidentId);
  if (stillCurrent()) api.liveData.invalidate([{ type: "incidents" }]);
}

/** Where an event came from: its device's name, or its job source's name. Empty for an ongoing
 * alert, which names neither. */
export function sourceLabel(alert: Pick<AlertView, "source" | "deviceId" | "deviceName">): string {
  if (alert.source === undefined) return "";
  if (alert.source === "device") return alert.deviceName ?? alert.deviceId ?? "";
  const key = `source.${alert.source}`;
  const label = tKit(key);
  return label === key ? alert.source : label;
}

export function areaLabel(area: string): string {
  const key = `alerts.area.${area}`;
  const label = tKit(key);
  return label === key ? area : label;
}

const SEVERITY_LABELS = {
  error: "alerts.severity.error",
  warning: "alerts.severity.warning",
  notice: "alerts.severity.notice",
} as const satisfies Record<AlertView["severity"], StringKey>;

export function severityLabel(severity: AlertView["severity"]): string {
  return t(SEVERITY_LABELS[severity]);
}

export function formatAlertTime(iso: string | null): string {
  if (iso === null) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** A screen's navigation label, under its own name or with its hyphens as underscores
 * (`content-languages` is labelled `nav.content_languages`). */
function navLabel(screen: string): string | null {
  for (const key of [`nav.${screen}`, `nav.${screen.replaceAll("-", "_")}`]) {
    const label = tKit(key);
    if (label !== key) return label;
  }
  return null;
}

/** A screen with no navigation label is named by its screen name, like an unknown area. */
export function goToLabel(screen: string): string {
  return fill("alerts.go_to", { screen: navLabel(screen) ?? screen });
}
