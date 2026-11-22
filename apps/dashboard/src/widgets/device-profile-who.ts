import { type TemplateResult, html, nothing } from "lit";
import type { JobRole } from "../api/client.js";
import { t } from "../i18n/t.js";
import { renderSwitchGroup } from "./device-profile-switch-group.js";

interface WhoProps {
  roles: readonly JobRole[];
  roleIds: readonly string[];
  rolesRead: boolean;
  rolesError: string | undefined;
  onRole: (event: CustomEvent<{ checked: boolean }>, roleId: string) => void;
}

export function renderDeviceProfileWho({
  roles,
  roleIds,
  rolesRead,
  rolesError,
  onRole,
}: WhoProps): TemplateResult {
  return html`
    <h2 class="section-title">${t("device_profiles.who_heading")}</h2>
    ${renderSwitchGroup(
      "profile-roles",
      t("device_profiles.roles"),
      rolesError,
      roles.map(
        (role) =>
          html`<wt-switch
            data-test=${`profile-role-${role.id}`}
            name="admittedStaffRoleIds"
            label=${role.name}
            .checked=${roleIds.includes(role.id)}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => onRole(e, role.id)}
          ></wt-switch>`,
      ),
    )}
    ${rolesRead && roleIds.length === 0 ? html`<p class="hint" data-test="admitted-people" aria-live="polite">${t("device_profiles.admitted_nobody")}</p>` : nothing}
  `;
}
