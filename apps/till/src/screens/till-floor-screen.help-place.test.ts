import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { helpBadgeLabel } from "../i18n/help-strings.js";
import type { FloorZone, TableState } from "../api/client.js";

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: "Lunch",
  layoutDue: { setId: "set-dinner", revision: 3, periodName: "Dinner" },
  serviceMode: "table_tab",
};

function planned(id: string, x: number): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: {
      placement: { x, y: 3, width: 4, height: 4, shape: "rect", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 5,
    },
    signals: [],
    party: null,
  };
}

let locale = currentLocale();
let viewport = { width: 0, height: 0 };
beforeEach(() => {
  locale = currentLocale();
  viewport = { width: window.innerWidth, height: window.innerHeight };
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(viewport.width, viewport.height);
});

async function mount(width: number, lang: "en" | "es", canChangeToday: boolean) {
  setLocale(lang);
  await page.viewport(width, 900);
  const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone],
    tables: [planned("t1", 2), planned("t2", 12)],
    canChangeToday,
  });
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  setHelpMode(true);
  await el.updateComplete;
  const badges = [...el.shadowRoot!.querySelectorAll<WtHelpTooltip>("wt-help-tooltip")];
  for (const badge of badges) await badge.updateComplete;
  await document.fonts.ready;
  return el;
}

const badgeFor = (el: TillFloorScreen, part: string) =>
  el.shadowRoot!.querySelector<WtHelpTooltip>(
    `wt-help-tooltip[aria-label="${helpBadgeLabel(part)}"]`,
  )!;

/** The badge's centre is on `control`'s top trailing corner, give or take a few pixels. */
function expectOnCorner(badge: WtHelpTooltip, control: Element): void {
  const at = badge.getBoundingClientRect();
  const corner = control.getBoundingClientRect();
  expect(corner.width).toBeGreaterThan(0);
  expect(at.width).toBeGreaterThan(0);
  expect(Math.abs(at.left + at.width / 2 - corner.right)).toBeLessThanOrEqual(4);
  expect(Math.abs(at.top + at.height / 2 - corner.top)).toBeLessThanOrEqual(4);
}

/** The toolbar's last drawn control: the zone menu's button when there is one, else the view
 * toggle. */
function lastToolbarControl(el: TillFloorScreen): Element {
  const trigger = el
    .shadowRoot!.querySelector("till-floor-zone-menu")
    ?.shadowRoot!.querySelector("wt-row-actions")
    ?.shadowRoot!.querySelector("button");
  return trigger ?? el.shadowRoot!.querySelector("[data-view-toggle]")!;
}

const cases = [1280, 390].flatMap((width) =>
  (["en", "es"] as const).flatMap((lang) =>
    [true, false].map((canChangeToday) => [width, lang, canChangeToday] as const),
  ),
);

describe("Floor's badges hang on the controls they explain", () => {
  // The banner is drawn only for someone who may change today's floor.
  it.each(cases.filter(([, , canChangeToday]) => canChangeToday))(
    "at %i px (%s, may change today's floor: %s) the layout badge is on Update layout's corner",
    async (width, lang, canChangeToday) => {
      const el = await mount(width, lang, canChangeToday);
      const update = el.shadowRoot!.querySelector("[data-layout-due] wt-button")!;
      expectOnCorner(badgeFor(el, t("floor.update_layout")), update);
    },
  );

  it.each(cases)(
    "at %i px (%s, may change today's floor: %s) the tables badge is on the toolbar's last control",
    async (width, lang, canChangeToday) => {
      const el = await mount(width, lang, canChangeToday);
      expectOnCorner(badgeFor(el, t("floor.map_label")), lastToolbarControl(el));
    },
  );
});
