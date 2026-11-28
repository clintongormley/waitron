import { css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import type { FloorCueIcon, ZoneTab } from "@waitron/ui";
import type { ResolvedKitchenScreen } from "../api/device-session-api.js";
import type { WtRowActions } from "@waitron/ui/src/components/wt-row-actions.js";
import type { ShellAffordance, TillShell } from "./till-shell.js";
import type { TillFloorScreen } from "../screens/till-floor-screen.js";
import type { TableState } from "../api/floor-api.js";
import { helpBadgeLabel, helpText, type HelpKey } from "../i18n/help-strings.js";
import type { StringKey } from "../i18n/strings.js";
import { countText, t } from "../i18n/t.js";
import type { TillClockAction } from "../state/clocking.js";
import { kindCue, kindWords, mapKinds, topTabKind, type MapKind } from "../state/floor-look.js";

import { PHONE_WIDTH } from "./chooser-styles.js";
import { floorBreakStrip } from "./floor-clock-controls.js";

import "@waitron/ui/src/components/wt-menu-row.js";

type Marks = ReadonlyMap<string, { kind: MapKind; words: string }>;

export const floorToastStyles = css`
  :host {
    --wt-floor-controls-height: 0px;
  }
  .submitted-toast {
    position: fixed;
    inset-inline: var(--wt-space-3);
    bottom: max(
      calc(var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom)),
      calc(var(--wt-floor-controls-height) + var(--wt-page-padding, 0px) + var(--wt-space-2))
    );
    z-index: 10;
  }
  .app:has(till-floor-screen[ready-bar]) .submitted-toast {
    bottom: calc(
      var(--wt-page-padding) + var(--wt-tap-min) + 2 * var(--wt-space-3) +
        env(safe-area-inset-bottom)
    );
  }
`;

export const floorScreenLayoutStyles = css`
  wt-floor-map {
    border-radius: var(--wt-radius-md);
    outline: 1px solid var(--wt-color-border);
    outline-offset: -1px;
  }
  wt-floor-map::part(name),
  wt-floor-map::part(name-probe) {
    --wt-floor-table-weight: 700;
    font-size: calc((var(--wt-font-size-md) + 3 * var(--wt-font-size-lg)) / 4);
    font-weight: var(--wt-floor-table-weight);
  }
  @media not all and ${unsafeCSS(PHONE_WIDTH)} {
    wt-floor-map::part(name) {
      text-wrap: wrap;
      max-block-size: 100%;
    }
  }
  .screen[data-floor-footer] {
    position: relative;
    padding: 0 max(var(--wt-space-3), env(safe-area-inset-right)) var(--wt-space-1)
      max(var(--wt-space-3), env(safe-area-inset-left));
  }
  .screen[data-floor-footer] .zone-toolbar,
  .screen[data-floor-footer] .actions {
    display: contents;
  }
  .screen[data-floor-footer] .actions > wt-help-tooltip {
    inset-block-start: var(--wt-space-2);
    inset-inline-end: var(--wt-space-2);
    z-index: 1;
  }
  .screen[data-floor-footer] .map {
    flex: 1;
  }
  .screen[data-floor-footer] wt-floor-map {
    flex: 1;
    inline-size: 100%;
    aspect-ratio: auto;
    min-block-size: calc(var(--wt-tap-min) * 3);
    border-radius: calc((var(--wt-radius-md) + var(--wt-radius-lg)) / 2);
  }
  wt-floor-map {
    --wt-floor-map-name-wrap: wrap;
  }
`;

export const floorBarStyles = css`
  .floor-controls {
    display: flex;
    flex-direction: column;
    flex: none;
  }
  .floor-bar {
    --wt-floor-menu-font-size: calc((var(--wt-font-size-md) + var(--wt-font-size-lg)) / 2);
    --wt-floor-name-font-size: calc((var(--wt-floor-menu-font-size) + var(--wt-font-size-lg)) / 2);
    --wt-row-actions-sheet-inline-inset: var(--wt-page-padding, 0px);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--wt-space-2);
    padding: var(--wt-space-2) max(var(--wt-space-3), env(safe-area-inset-right))
      max(var(--wt-space-2), env(safe-area-inset-bottom))
      max(var(--wt-space-3), env(safe-area-inset-left));
    background: var(--wt-color-surface);
    border-block-start: 1px solid var(--wt-color-border);
  }
  .floor-bar::after {
    content: "";
    position: absolute;
    background: inherit;
    pointer-events: none;
  }
  @media (orientation: portrait) {
    .shell:has(> .floor-controls) > .region,
    .floor-controls {
      margin-inline: calc(-1 * var(--wt-page-padding, 0px));
    }
    .floor-bar {
      --wt-row-actions-sheet-inline-inset: 0px;
    }
    .floor-bar::after {
      inset: 100% 0 auto;
      block-size: var(--wt-page-padding, 0px);
    }
  }
  @media (orientation: landscape) {
    .floor-controls {
      margin-block-end: calc(-1 * max(0px, var(--wt-page-padding, 0px) - var(--wt-space-2)));
    }
    .floor-bar {
      isolation: isolate;
    }
    .floor-bar::after {
      inset: calc(-1 * var(--wt-field-line-width)) calc(-1 * var(--wt-page-padding, 0px))
        calc(-1 * min(var(--wt-page-padding, 0px), var(--wt-space-2)));
      z-index: -1;
      border-block-start: inherit;
    }
  }
  .floor-bar wt-row-actions::part(popup) {
    overflow: visible;
    box-shadow: none;
  }
  .floor-bar wt-row-actions::part(popup)::after {
    content: "";
    position: absolute;
    inset-inline: var(--wt-row-actions-sheet-inline-inset);
    inset-block-start: calc(100% + var(--wt-field-line-width));
    block-size: calc(var(--wt-space-3) + var(--wt-space-1) / 2);
    background: linear-gradient(var(--wt-color-menu-sheet-edge-shadow), transparent);
    pointer-events: none;
  }
  .floor-bar wt-row-actions::part(sheet) {
    padding-block-end: 0;
    box-shadow: none;
  }
  .floor-bar > [data-view-toggle]::part(button) {
    min-block-size: calc(var(--wt-tap-min) + var(--wt-space-1));
    min-inline-size: calc(var(--wt-tap-min) * 1.5);
  }
  .floor-bar > wt-row-actions::part(trigger) {
    min-block-size: calc(var(--wt-tap-min) + var(--wt-space-1));
    inline-size: 100%;
    border: 1px solid var(--wt-color-border);
    background: var(--wt-color-surface);
  }
  .floor-bar [data-floor-zone-chooser]::part(trigger) {
    padding-inline: var(--wt-space-3);
    overflow-wrap: anywhere;
    justify-content: start;
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
    text-align: start;
  }
  .floor-zone-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-2);
  }
  .floor-zone-trigger [aria-hidden] {
    font-size: var(--wt-font-size-md);
  }
  .floor-bar .floor-menu::part(trigger) {
    min-inline-size: calc(var(--wt-tap-min) + var(--wt-space-1));
  }
  .floor-menu wt-icon[slot="trigger"] {
    inline-size: var(--wt-font-size-xl);
    block-size: var(--wt-font-size-xl);
  }
  .floor-bar [slot="badge"] {
    inset-block-start: calc(-1 * var(--wt-space-1));
    inset-inline-end: calc(-1 * var(--wt-space-1));
  }
  .floor-bar [data-floor-zone] {
    position: relative;
    border-radius: 0;
    font-size: var(--wt-floor-name-font-size);
  }
  .floor-bar [data-floor-zone] > [data-row-check] {
    position: absolute;
    inset-inline-start: var(--wt-menu-row-padding-start);
  }
  .floor-bar [data-floor-zone][aria-checked="true"] [data-row-check] {
    --wt-action-native-icon-color: var(--wt-color-primary);
    color: var(--wt-action-native-icon-color);
  }
  .floor-bar [data-floor-zone-chooser] [data-menu-heading] {
    padding-block-start: calc(var(--wt-space-3) + var(--wt-space-1) / 2);
    letter-spacing: calc(var(--wt-font-size-sm) * 0.04);
  }
  .floor-bar [data-floor-zone-chooser] wt-menu-row {
    --wt-menu-row-height: calc(var(--wt-tap-min) + var(--wt-space-4));
    --wt-menu-row-padding-start: calc(var(--wt-space-5) + var(--wt-space-6));
    --wt-menu-row-label-size: var(--wt-floor-name-font-size);
    --wt-font-weight-normal: var(--wt-font-weight-bold);
  }
  .floor-bar [data-open-device-zones] {
    min-block-size: var(--wt-menu-row-height);
    justify-content: center;
    color: var(--wt-color-primary-text);
    font-size: calc((var(--wt-font-size-md) + var(--wt-floor-menu-font-size)) / 2);
    font-weight: var(--wt-font-weight-bold);
    text-align: center;
  }
  .floor-bar .settings-heading,
  .floor-bar [data-menu-heading] {
    margin: 0;
    padding: var(--wt-space-2) var(--wt-menu-row-padding-start) var(--wt-space-1);
    border-block-end: 1px solid var(--wt-color-border);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    text-transform: uppercase;
  }
  .floor-menu summary {
    display: block;
    cursor: pointer;
  }
  .floor-menu details[open] > summary wt-menu-row::part(chevron) {
    rotate: 90deg;
  }
  .floor-menu .logout {
    --wt-font-weight-normal: var(--wt-font-weight-bold);
    color: var(--wt-color-primary-text);
  }
  [data-floor-other-zone] {
    margin: var(--wt-space-1) max(var(--wt-space-3), env(safe-area-inset-right)) var(--wt-space-2)
      max(var(--wt-space-3), env(safe-area-inset-left));
  }
  [data-floor-other-zone]::part(button) {
    min-block-size: var(--wt-tap-min);
    justify-content: start;
    background: var(--wt-color-tab-warning-tint);
    border-color: transparent;
    font-size: calc((3 * var(--wt-font-size-md) + var(--wt-font-size-lg)) / 4);
    font-weight: var(--wt-font-weight-normal);
    text-align: start;
  }
  [data-floor-other-zone] wt-icon {
    flex: none;
    margin-inline-start: auto;
    color: var(--wt-color-text-muted);
  }
  .floor-zone-mark {
    margin-inline-start: auto;
    padding-inline: var(--wt-space-2);
    border-radius: var(--wt-radius-full);
    background: var(--wt-color-field-fill);
  }
  .floor-zone-mark[data-mark="ready"] {
    background: var(--wt-color-success);
    color: var(--wt-color-on-success);
  }
`;

export function floorMoreSheet(
  count: number | undefined,
  onBreak: boolean,
  contents: TemplateResult,
) {
  const pending = count !== undefined && count > 0;
  return html`<wt-row-actions
    class="floor-menu"
    data-test="more-menu"
    icon="hamburger"
    bottom-sheet
    sheet-variant="menu"
    focus-sheet
    label=${pending ? countText(count, "shell.more_transfers", "shell.more_transfers_one") : t("shell.more")}
  >
    <wt-icon slot="trigger" aria-hidden="true" name="hamburger"></wt-icon>
    ${onBreak ? html`<span slot="trigger" data-break-dot ?data-has-count=${pending} aria-hidden="true"></span>` : nothing}
    ${pending ? html`<wt-count-badge slot="badge" tone="warning" .count=${count}></wt-count-badge>` : nothing}
    ${contents}
  </wt-row-actions>`;
}

export function floorMoreRow(
  label: string,
  press: (event: Event) => void,
  options: {
    className?: string;
    value?: number;
    help?: HelpKey;
    transfers?: boolean;
    report?: boolean;
    clock?: TillClockAction | "retry";
    disabled?: boolean;
  },
) {
  const logout = options.className === "logout";
  return html`<wt-menu-row
    action
    ?divider=${!logout}
    .chevron=${!logout}
    .disabled=${options.disabled ?? false}
    data-clock-action=${options.clock === "retry" ? nothing : (options.clock ?? nothing)}
    ?data-clock-retry=${options.clock === "retry"}
    class=${options.className ?? nothing}
    .label=${label}
    .value=${options.value ?? ""}
    help=${options.help === undefined ? nothing : helpText(options.help)}
    help-label=${helpBadgeLabel(label)}
    ?data-open-transfers=${options.transfers}
    ?data-report-problem=${options.report}
    @click=${press}
  ></wt-menu-row>`;
}

export function floorDeviceRows(
  language: TemplateResult | typeof nothing,
  help: TemplateResult,
  settings: TemplateResult,
) {
  return html`
    ${language === nothing ? nothing : html`<wt-menu-row>${language}</wt-menu-row>`}
    <wt-menu-row divider .label=${helpText("help.label")}>${help}</wt-menu-row>
    <details class="settings-group">
      <summary>
        <wt-menu-row divider chevron .label=${t("device_zones.settings")}></wt-menu-row>
      </summary>
      ${settings}
    </details>
  `;
}

export function floorHoursRows(busy: boolean, press: (type: "my-hours" | "fix-my-hours") => void) {
  const label = t("attendance.fix_hours");
  return html`<wt-menu-row
      action
      divider
      chevron
      data-my-hours
      .disabled=${busy}
      .label=${t("hours.mine")}
      @click=${() => press("my-hours")}
    ></wt-menu-row>
    <wt-menu-row
      action
      divider
      chevron
      data-fix-hours
      .disabled=${busy}
      .label=${label}
      help=${helpText("help.person.fix_hours")}
      help-label=${helpBadgeLabel(label)}
      @click=${() => press("fix-my-hours")}
    ></wt-menu-row>`;
}

export function floorMenuSection(label: StringKey, rows: TemplateResult) {
  return html`<section class="settings-group" aria-label=${t(label)}>
    <span class="settings-heading">${t(label)}</span>${rows}
  </section>`;
}

export function measureFloorControls(controls: HTMLElement): number {
  const bar = controls.querySelector("footer")!;
  bar.style.setProperty(
    "--wt-menu-sheet-bottom-offset",
    `${Math.max(0, innerHeight - bar.getBoundingClientRect().top)}px`,
  );
  return controls.getBoundingClientRect().height;
}

export interface FloorKitchenRow {
  label: string;
  stationId?: string;
}

export interface FloorChooserActions {
  choose: () => void;
  counters: readonly { id: string; name: string }[];
  openCounter: (zoneId: string) => void;
  kitchen: readonly FloorKitchenRow[];
  openKitchen: (stationId?: string) => void;
}

export function pendingFloorControls(floor: TillFloorScreen, active: string | undefined) {
  if (floor.firstRead === undefined) return undefined;
  const selected = active ?? floor.selectedZoneId;
  const zone = floor.knownZones?.find(({ id }) => id === selected) ?? floor.knownZones?.[0];
  return { name: zone?.name, view: floor.viewMemory?.read(zone?.id ?? selected ?? "") ?? "map" };
}

export function floorControls(
  shell: TillShell,
  floor: TillFloorScreen,
  menu: TemplateResult,
  now: number,
  emit: (type: string, detail?: unknown) => void,
): TemplateResult {
  return html`<div class="floor-controls">
    ${floor.otherZoneLine()}
    ${shell.clockAvailable ? floorBreakStrip(shell.clockState, now, shell.clockBusy, () => emit("clock-action", { action: "break-end" })) : nothing}
    <footer data-floor-bar class="floor-bar">
      ${floor.footerControls({
        choose: () => emit("open-device-zones"),
        counters: shell.formFactor === "till" && shell.showCounter ? shell.counterZones : [],
        openCounter: (zoneId) =>
          shell.counterZones.length === 1 && zoneId === shell.selectedCounterZoneId
            ? emit("screen-select", { screen: "counter", counterFloor: true })
            : emit("counter-zone-selected", { zoneId, counterFloor: true }),
        kitchen: shell.floorKitchenRows,
        openKitchen: (stationId) =>
          emit(stationId === undefined ? "show-expo" : "show-station", {
            stationId,
            fromFloorChooser: true,
          }),
      })}${menu}
    </footer>
  </div>`;
}

export function floorKitchenRows(
  screen: ResolvedKitchenScreen | undefined,
  affordances: readonly ShellAffordance[],
): FloorKitchenRow[] {
  if (!screen?.available) return [];
  if (screen.kind === "station")
    return affordances.includes("station")
      ? screen.stations
          .filter((station) => station.available)
          .map(({ id, name }) => ({ label: name, stationId: id }))
      : [];
  return affordances.includes("expo")
    ? [{ label: t(screen.kind === "pass_monitor" ? "kitchen_screen.pass_display" : "expo.open") }]
    : [];
}

export async function restoreFloorZoneFocus(shell: TillShell | null): Promise<void> {
  await shell?.updateComplete;
  const zoneChooser = shell?.shadowRoot?.querySelector<WtRowActions>("[data-floor-zone-chooser]");
  if (zoneChooser) {
    await zoneChooser.updateComplete;
    zoneChooser.focus();
  } else {
    const floor = shell?.querySelector("till-floor-screen");
    await floor?.updateComplete;
    floor?.focusZoneToolbar();
  }
}

export function floorZoneControls(
  tabs: readonly ZoneTab[],
  marks: Marks,
  active: string | undefined,
  view: "map" | "list",
  select: (key: string) => void,
  toggle: () => void,
  { choose, counters, openCounter, kitchen, openKitchen }: FloorChooserActions,
  pending?: ReturnType<typeof pendingFloorControls>,
) {
  const name = pending?.name ?? tabs.find((tab) => tab.key === active)?.name ?? t("floor.zones");
  return html`<wt-row-actions
      data-floor-zone-chooser
      bottom-sheet
      sheet-variant="menu"
      label=${name}
      sheet-label=${t("floor.zones")}
    >
      <span slot="trigger" class="floor-zone-trigger"
        ><span>${name}</span><span aria-hidden="true">⌃</span></span
      >
      <div role="menu" aria-label=${t("floor.zones")}>
        ${tabs.map(({ key, name }, index) => {
          const mark = marks.get(key);
          return html`<button
            type="button"
            role="menuitemradio"
            data-row-choice
            data-floor-zone=${key}
            aria-checked=${key === active ? "true" : "false"}
            @click=${() => select(key)}
          >
            <wt-icon data-row-check name="menu-check" size="lg"></wt-icon>
            <wt-menu-row
              ?divider=${index < tabs.length - 1 || counters.length > 0 || kitchen.length === 0}
              label=${name}
            >
              ${mark ? html`<span class="floor-zone-mark" data-mark=${mark.kind}>${mark.words}</span>` : nothing}
            </wt-menu-row>
          </button>`;
        })}
        ${counters.map(
          ({ id, name }, index) =>
            html`<button
              type="button"
              role="menuitem"
              data-row-choice
              data-floor-counter-zone=${id}
              @click=${() => openCounter(id)}
            >
              <wt-menu-row
                ?divider=${index < counters.length - 1 || kitchen.length === 0}
                label=${name}
              ></wt-menu-row>
            </button>`,
        )}
        ${
          kitchen.length === 0
            ? nothing
            : html` <div role="group" aria-label=${t("floor.kitchen_screens")}>
                <div data-menu-heading aria-hidden="true">${t("floor.kitchen_screens")}</div>
                ${kitchen.map(
                  ({ label, stationId }) =>
                    html`<button
                      type="button"
                      role="menuitem"
                      data-row-choice
                      data-floor-kitchen-row
                      @click=${() => openKitchen(stationId)}
                    >
                      <wt-menu-row divider label=${label}></wt-menu-row>
                    </button>`,
                )}
              </div>`
        }
        <button
          type="button"
          role="menuitem"
          data-row-choice
          data-open-device-zones
          @click=${choose}
        >
          ${t("floor.choose_zones")}
        </button>
      </div>
    </wt-row-actions>
    <wt-button
      variant="secondary"
      data-view-toggle
      ?disabled=${pending !== undefined}
      @click=${toggle}
    >
      ${t((pending?.view ?? view) === "map" ? "floor.view_list" : "floor.view_map")}
    </wt-button>`;
}

export function floorOtherZone(
  tabs: readonly ZoneTab[],
  marks: Marks,
  active: string | undefined,
  select: (key: string) => void,
) {
  const others = tabs.filter(({ key }) => key !== active && marks.has(key));
  const top = topTabKind(new Set(others.map(({ key }) => marks.get(key)!.kind)));
  const zone = others.find(({ key }) => marks.get(key)!.kind === top);
  return zone === undefined
    ? nothing
    : html`<wt-button data-floor-other-zone variant="secondary" @click=${() => select(zone.key)}>
        <span><strong>${zone.name}</strong> · ${marks.get(zone.key)!.words}</span>
        <wt-icon aria-hidden="true" name="chevron-right" size="lg"></wt-icon>
      </wt-button>`;
}

/** What a hidden zone's tab shows: its tables' most urgent state. */
export interface ZoneTabMark {
  kind: MapKind;
  icon: FloorCueIcon | null;
  words: string;
}

export function zoneTabMarks(
  tables: readonly TableState[],
  tabs: readonly ZoneTab[],
  activeKey: string | undefined,
  now: number,
): Map<string, ZoneTabMark> {
  const hidden = new Set(tabs.map((tab) => tab.key).filter((key) => key !== activeKey));
  const byZone = new Map<string, { table: TableState; kinds: MapKind[] }[]>();
  for (const table of tables) {
    if (table.zoneId === null || !hidden.has(table.zoneId)) continue;
    const rows = byZone.get(table.zoneId) ?? [];
    rows.push({ table, kinds: mapKinds(table, now) });
    byZone.set(table.zoneId, rows);
  }
  const marks = new Map<string, ZoneTabMark>();
  for (const [zoneId, rows] of byZone) {
    const kind = topTabKind(new Set(rows.flatMap((row) => row.kinds)));
    if (kind === null) continue;
    const members = rows.filter((row) => row.kinds.includes(kind)).map((row) => row.table);
    const icon = kindCue(kind, members, now)?.icon ?? null;
    marks.set(zoneId, { kind, icon, words: kindWords(kind, members, now) });
  }
  return marks;
}
