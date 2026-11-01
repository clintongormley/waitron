import { html, nothing } from "lit";
import { t } from "../i18n/t.js";

interface RecoveryRefusal {
  code: string;
  recoveryUrl?: string;
  manualCard?: true;
}

function recoveryPath(refusal: RecoveryRefusal | null): string | null {
  const path = refusal?.recoveryUrl;
  if (path === undefined || !path.startsWith("/manage/")) return null;
  const parsed = new URL(path, location.origin);
  return parsed.pathname === path ? path : null;
}

export function recoveryRefusalOf(value: unknown): RecoveryRefusal | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { code, recoveryUrl } = value as { code?: unknown; recoveryUrl?: unknown };
  if (typeof code !== "string" || typeof recoveryUrl !== "string") return undefined;
  const refusal = { code, recoveryUrl };
  return recoveryPath(refusal) === null ? undefined : refusal;
}

export function recoveryRefusalText(refusal: RecoveryRefusal): string | null {
  if (recoveryPath(refusal) === null) return null;
  const next = t("recovery.issuance_stopped");
  if (refusal.manualCard === true) return `${t("recovery.manual_card")} ${next}`;
  return refusal.code === "sale.charged_not_recorded" ? `${t("recovery.charged")} ${next}` : next;
}

export function recoveryLink(refusal: RecoveryRefusal | null, onDanger = false) {
  const path = recoveryPath(refusal);
  return path === null
    ? nothing
    : html`<a
        slot="secondary"
        data-recovery
        href=${path}
        target="_blank"
        rel="noopener"
        style=${onDanger ? "color: var(--wt-color-on-danger)" : "color: var(--wt-color-primary-text)"}
        >${t("recovery.open")}</a
      >`;
}
