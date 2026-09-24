import { t as tKit } from "@waitron/dashboard-kit";
import { currentLocale, t } from "../i18n/t.js";
import type { AlertView, DashboardApi } from "../api/client.js";

const INCIDENT_PREFIX = "incident:";

export function incidentIdOf(alert: Pick<AlertView, "key" | "kind">): string | null {
  return alert.kind === "event" && alert.key.startsWith(INCIDENT_PREFIX)
    ? alert.key.slice(INCIDENT_PREFIX.length)
    : null;
}

/** The screen a "Go to" action opens. Only an ongoing alert names the screen that fixes it; an event
 * is marked handled instead. */
export function screenTargetOf(
  alert: Pick<AlertView, "kind" | "screen">,
  canOpen: (screen: string) => boolean,
): string | null {
  return alert.kind === "ongoing" && alert.screen !== undefined && canOpen(alert.screen)
    ? alert.screen
    : null;
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

export function areaLabel(area: string): string {
  const key = `alerts.area.${area}`;
  const label = tKit(key);
  return label === key ? area : label;
}

export function severityLabel(severity: AlertView["severity"]): string {
  return t(severity === "error" ? "alerts.severity.error" : "alerts.severity.warning");
}

export function formatAlertTime(iso: string | null): string {
  if (iso === null) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** A screen with no navigation label is named by its screen name, like an unknown area. */
export function goToLabel(screen: string): string {
  const key = `nav.${screen}`;
  const label = tKit(key);
  return t("alerts.go_to").replace("{screen}", label === key ? screen : label);
}
