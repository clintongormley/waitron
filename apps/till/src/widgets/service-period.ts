import { css, html, nothing } from "lit";
import type { MenuState, TillApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import "./keep-open.js";

export const servicePeriodStyles = css`
  .service-period {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
  }
`;

export function servicePeriod(
  service: MenuState["service"] | null,
  departmentName: string,
  api: TillApi | undefined,
  zoneId: string,
  zoneName = "",
) {
  if (!service) return nothing;
  const subject = service.keepOpen;
  const line = subject
    ? t(subject.extendedUntil === null ? "keep_open.line_until" : "keep_open.line_extended")
        .replace("{period}", () => subject.periodName)
        .replace("{time}", () => subject.extendedUntil ?? subject.endsAt)
    : service.periodName;
  if (service.open && service.zoneOpen && line === null && !service.zoneKeepOpen) return nothing;
  return html`<div class="service-period">
    ${
      !service.zoneOpen
        ? html`<p role="status" data-zone-closed>
            ${t("menu.zone_closed").replace("{zone}", () => zoneName || service.zoneKeepOpen?.zoneName || "")}
          </p>`
        : service.open
          ? html`<p role="status" data-service-period>${line}</p>`
          : html`<p role="status" data-service-closed>
              ${t("menu.department_closed").replace("{department}", () => departmentName)}
            </p>`
    }
    ${service.zoneOpen && subject ? html`<till-keep-open .api=${api} .zoneId=${zoneId} .keepOpen=${subject}></till-keep-open>` : nothing}
    ${zoneKeepOpen(service.zoneKeepOpen, api, zoneId)}
  </div>`;
}

export function zoneKeepOpen(
  subject: MenuState["service"]["zoneKeepOpen"],
  api: TillApi | undefined,
  zoneId: string,
) {
  return subject
    ? html`<till-keep-open
        subject="zone"
        .api=${api}
        .zoneId=${zoneId}
        .zoneKeepOpen=${subject}
      ></till-keep-open>`
    : nothing;
}
