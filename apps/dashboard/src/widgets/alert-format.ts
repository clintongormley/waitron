import { t as tKit } from "@waitron/dashboard-kit";
import { currentLocale, t } from "../i18n/t.js";
import type { AlertView } from "../api/client.js";

const INCIDENT_PREFIX = "incident:";

export function incidentIdOf(alert: Pick<AlertView, "key" | "kind">): string | null {
  return alert.kind === "event" && alert.key.startsWith(INCIDENT_PREFIX)
    ? alert.key.slice(INCIDENT_PREFIX.length)
    : null;
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

export function goToLabel(screen: string): string {
  return t("alerts.go_to").replace("{screen}", tKit(`nav.${screen}`));
}
