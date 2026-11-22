import { type TemplateResult, html, nothing } from "lit";
import type { KitchenScreenKind, ProfileKitchenScreen } from "../api/client.js";
import { KITCHEN_SCREEN_KINDS } from "../api/client.js";
import { t } from "../i18n/t.js";
import { renderSwitchGroup } from "./device-profile-switch-group.js";

type ListKey = "stationIds" | "zoneIds";

interface ListEntry {
  id: string;
  name: string;
  active: boolean;
}

export interface KitchenListsProps {
  kind: KitchenScreenKind;
  slug: string;
  stationsField: string;
  zonesField: string | null;
  scope: ProfileKitchenScreen;
  stations: readonly ListEntry[];
  zones: readonly ListEntry[];
  stationsError: string | undefined;
  zonesError: string | undefined;
  onEveryStation: (event: CustomEvent<{ checked: boolean }>) => void;
  onEveryZone: (event: CustomEvent<{ checked: boolean }>) => void;
  onListed: (event: CustomEvent<{ checked: boolean }>, key: ListKey, id: string) => void;
  onShowOtherStations: (event: CustomEvent<{ checked: boolean }>) => void;
}

interface KitchenScreensProps {
  selected: KitchenScreenKind | undefined;
  error: string;
  lists: KitchenListsProps | undefined;
  onKind: (event: CustomEvent<{ value: string }>) => void;
}

function listChoices(
  all: readonly ListEntry[],
  listed: readonly string[],
): { id: string; label: string; on: boolean }[] {
  return all
    .filter((entry) => entry.active)
    .map((entry) => ({
      id: entry.id,
      label: entry.name,
      on: listed.includes(entry.id),
    }));
}

/** "Every station", or a switch per station; for a pass screen or monitor the same for zones. */
function renderKindLists({
  kind,
  slug,
  stationsField,
  zonesField,
  scope,
  stations,
  zones,
  stationsError,
  zonesError,
  onEveryStation,
  onEveryZone,
  onListed,
  onShowOtherStations,
}: KitchenListsProps): TemplateResult {
  const list = (
    key: ListKey,
    field: string,
    error: string | undefined,
    every: {
      test: string;
      label: string;
      handler: (e: CustomEvent<{ checked: boolean }>) => void;
    },
    all: readonly ListEntry[],
    item: string,
    heading: string,
  ) => {
    const listed = scope[key];
    return renderSwitchGroup(
      `profile-${slug}-${key === "stationIds" ? "stations" : "zones"}`,
      heading,
      error,
      [
        html`<wt-switch
          data-test=${every.test}
          name=${field}
          label=${every.label}
          .checked=${listed === null}
          @wt-change=${every.handler}
        ></wt-switch>`,
        ...(key === "stationIds" && listed?.length === 0
          ? [
              html`<p class="hint" data-test="empty-station-selection">
                ${t("devices.empty_station_selection")}
              </p>`,
            ]
          : []),
        ...(listed === null
          ? []
          : listChoices(all, listed).map(
              (choice) =>
                html`<wt-switch
                  data-test="profile-${slug}-${item}-${choice.id}"
                  name=${field}
                  label=${choice.label}
                  .checked=${choice.on}
                  @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                    onListed(e, key, choice.id)}
                ></wt-switch>`,
            )),
      ],
    );
  };
  return html`<div class="nested" data-test="profile-${slug}-lists">
    ${list(
      "stationIds",
      stationsField,
      stationsError,
      {
        test: `profile-${slug}-every-station`,
        label: t("device_profiles.every_station"),
        handler: onEveryStation,
      },
      stations,
      "station",
      t("device_profiles.kitchen_stations"),
    )}
    ${
      zonesField === null
        ? nothing
        : list(
            "zoneIds",
            zonesField,
            zonesError,
            {
              test: `profile-${slug}-every-zone`,
              label: t("device_profiles.every_zone_venue"),
              handler: onEveryZone,
            },
            zones,
            "zone",
            t("device_profiles.kitchen_zones"),
          )
    }
    ${
      kind === "station"
        ? nothing
        : html`<wt-switch
            data-test="profile-${slug}-other-stations"
            name="showNonPassStations"
            label=${t("device_profiles.show_other_stations")}
            .checked=${scope.showNonPassStations ?? true}
            @wt-change=${onShowOtherStations}
          ></wt-switch>`
    }
  </div>`;
}

export function renderDeviceProfileKitchenScreens({
  selected,
  error,
  lists,
  onKind,
}: KitchenScreensProps): TemplateResult {
  return html`<p class="hint" data-test="kitchen-screens-hint">
      ${t("device_profiles.kitchen_screens_hint")}
    </p>
    <wt-combobox
      class="field"
      data-test="profile-kitchen-screens"
      name="kitchenScreens"
      label=${t("device_profiles.kitchen_screens")}
      search="never"
      show-empty-option
      .options=${[
        { value: "", label: t("device_profiles.kitchen_screen.none") },
        ...KITCHEN_SCREEN_KINDS.map((kind) => ({
          value: kind,
          label: t(`device_profiles.kitchen_screen.${kind}`),
        })),
      ]}
      .value=${selected ?? ""}
      .error=${error}
      .invalid=${Boolean(error)}
      @wt-change=${onKind}
    ></wt-combobox>
    ${lists === undefined ? nothing : renderKindLists(lists)}`;
}
