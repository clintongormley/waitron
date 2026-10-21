import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  toggleFloorView,
} from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
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

function planned(id: string, x: number, needsMoving: boolean): TableState {
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
      needsMoving,
    },
    signals: [],
    party: null,
  };
}

let viewport = { width: 0, height: 0 };
beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  await page.viewport(viewport.width, viewport.height);
});

const shown = async (el: TillFloorScreen) => {
  const badges = [...el.shadowRoot!.querySelectorAll<WtHelpTooltip>("wt-help-tooltip")];
  for (const badge of badges) await badge.updateComplete;
  return badges.filter((badge) => badge.getBoundingClientRect().width > 0);
};

describe.each(["light", "dark"] as const)("Floor's help badges a11y (%s theme)", (theme) => {
  async function mount() {
    await page.viewport(1280, 900);
    setHelpMode(true);
    const mounted = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      {
        zones: [zone],
        tables: [planned("t1", 2, false), planned("t3", 12, true)],
        canChangeToday: true,
      },
      theme,
    );
    mounted.host.style.setProperty("--wt-help-badge-target", "32px");
    mounted.host.style.setProperty("--wt-help-badge-size", "24px");
    return mounted;
  }

  it.each(["map", "list"] as const)(
    "the %s with the layout banner and help on has no violations",
    async (view) => {
      const { el, host } = await mount();
      if (view === "list") await toggleFloorView(el);
      expect(await shown(el)).toHaveLength(2);
      await expectNoA11yViolations(host);
    },
  );

  it("the Needs moving dialog with help on has no violations", async () => {
    const { el, host } = await mount();
    el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
      new CustomEvent("wt-table-tap", { detail: { tableId: "t3" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(await shown(el)).toHaveLength(3);
    await expectNoA11yViolations(host);
  });
});
