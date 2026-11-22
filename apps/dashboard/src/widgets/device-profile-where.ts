import { type TemplateResult, html, nothing } from "lit";
import type { ProfileScopeChoices } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import { renderGroupError, renderSwitchGroup } from "./device-profile-switch-group.js";

interface WhereProps {
  departments: readonly ProfileScopeChoices["departments"][number][];
  departmentId: string;
  zones: readonly ProfileScopeChoices["zones"][number][];
  allowedZones: readonly ProfileScopeChoices["zones"][number][];
  everyZone: boolean;
  zoneIds: readonly string[];
  startingZoneId: string;
  departmentError: string | undefined;
  zonesError: string | undefined;
  startingZoneError: string | undefined;
  onDepartment: (event: CustomEvent<{ value: string }>) => void;
  onEveryZone: (event: CustomEvent<{ checked: boolean }>) => void;
  onZone: (event: CustomEvent<{ checked: boolean }>, zoneId: string) => void;
  onStartingZone: (event: CustomEvent<{ value: string }>) => void;
}

function departmentOptions(
  departments: readonly ProfileScopeChoices["departments"][number][],
  departmentId: string,
) {
  return departments
    .filter((department) => department.active || department.id === departmentId)
    .map((department) => ({
      value: department.id,
      label: department.active
        ? department.name
        : `${department.name} (${t("device_profiles.department_disabled_mark")})`,
    }));
}

export function renderDeviceProfileWhere({
  departments,
  departmentId,
  zones,
  allowedZones,
  everyZone,
  zoneIds,
  startingZoneId,
  departmentError,
  zonesError,
  startingZoneError,
  onDepartment,
  onEveryZone,
  onZone,
  onStartingZone,
}: WhereProps): TemplateResult {
  const department = departments.find((entry) => entry.id === departmentId);
  const everyZoneHint = fill("device_profiles.every_zone_hint", {
    department: department?.name ?? "",
  });
  return html`
    <h2 class="section-title">${t("device_profiles.where_heading")}</h2>
    <wt-combobox
      class="field"
      data-test="profile-department"
      name="departmentId"
      required
      label=${t("device_profiles.department")}
      search="auto"
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      .options=${departmentOptions(departments, departmentId)}
      .value=${departmentId}
      .error=${departmentError ?? ""}
      .invalid=${Boolean(departmentError)}
      @wt-change=${onDepartment}
    >
      <wt-help-tooltip
        slot="help"
        mode="help-mode"
        aria-label=${t("device_profiles.department_help_label")}
        >${t("device_profiles.department_hint")}</wt-help-tooltip
      >
    </wt-combobox>
    ${
      departmentId === ""
        ? nothing
        : html`<div class="field">
              <wt-switch
                data-test="profile-every-zone"
                name="everyZone"
                label=${t("device_profiles.every_zone")}
                description=${everyZone ? everyZoneHint : ""}
                .checked=${everyZone}
                @wt-change=${onEveryZone}
              ></wt-switch>
              ${
                everyZone
                  ? html`<p class="hint" data-test="profile-zones-hint" aria-hidden="true">
                        ${everyZoneHint}
                      </p>
                      ${renderGroupError("profile-zones", zonesError)}`
                  : nothing
              }
            </div>
            ${
              everyZone
                ? nothing
                : renderSwitchGroup(
                    "profile-zones",
                    t("device_profiles.zones"),
                    zonesError,
                    zones.map(
                      (zone) =>
                        html`<wt-switch
                          data-test="profile-zone-${zone.id}"
                          name="allowedZoneIds"
                          label=${zone.name}
                          .checked=${zoneIds.includes(zone.id)}
                          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => onZone(e, zone.id)}
                        ></wt-switch>`,
                    ),
                  )
            }`
    }
    <wt-combobox
      class="field"
      data-test="profile-starting-zone"
      name="startingZoneId"
      required
      label=${t("device_profiles.starting_zone")}
      search="auto"
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      .options=${allowedZones.map((zone) => ({ value: zone.id, label: zone.name }))}
      .value=${startingZoneId}
      .error=${startingZoneError ?? ""}
      .invalid=${Boolean(startingZoneError)}
      @wt-change=${onStartingZone}
    >
      <wt-help-tooltip
        slot="help"
        mode="help-mode"
        aria-label=${t("device_profiles.starting_zone_help_label")}
        >${t("device_profiles.starting_zone_hint")}</wt-help-tooltip
      >
    </wt-combobox>
  `;
}
