import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtDialog, WtHelpTooltip } from "@waitron/ui";
import { cleanupWidgets, mountWidget, toggleFloorView } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { helpBadgeLabel, helpEn, helpEs, type HelpKey } from "../i18n/help-strings.js";
import type { FloorZone, TableState, TableToday } from "../api/client.js";

function zone(layoutDue: FloorZone["layoutDue"] = null): FloorZone {
  return {
    id: "z1",
    name: "Comedor",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: true,
    layoutSetName: "Lunch",
    layoutDue,
    serviceMode: "table_tab",
  };
}

function planned(id: string, x: number, over: Partial<TableToday> = {}): TableState {
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
      ...over,
    },
    signals: [],
    party: null,
  };
}

const dinner = { setId: "set-dinner", revision: 3, periodName: "Dinner" };

let locale = currentLocale();
let viewport = { width: 0, height: 0 };
beforeEach(async () => {
  locale = currentLocale();
  viewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en");
  await page.viewport(1280, 900);
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(viewport.width, viewport.height);
});

async function mount(over: Partial<TillFloorScreen> = {}) {
  const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone()],
    tables: [planned("t1", 2), planned("t2", 12)],
    canChangeToday: true,
    ...over,
  });
  // The till's shell sets the badge's size; a screen mounted alone takes the dashboard's.
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  return { el, host };
}

const badgeFor = (root: ParentNode, part: string) =>
  root.querySelector<WtHelpTooltip>(`wt-help-tooltip[aria-label="${helpBadgeLabel(part)}"]`);
const toolbarBadge = (el: TillFloorScreen) => badgeFor(el.shadowRoot!, t("floor.map_label"));
const bannerBadge = (el: TillFloorScreen) => badgeFor(el.shadowRoot!, t("floor.update_layout"));
const actions = (el: TillFloorScreen) => el.shadowRoot!.querySelector<HTMLElement>(".actions")!;
const banner = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-layout-due]")!;
const moveDialog = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<WtDialog>("[data-move-dialog]");
const allBadges = (el: TillFloorScreen) => [
  ...el.shadowRoot!.querySelectorAll<WtHelpTooltip>("wt-help-tooltip"),
];

const isOpen = (badge: WtHelpTooltip) =>
  badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");

async function helpOn(el: TillFloorScreen): Promise<void> {
  setHelpMode(true);
  await el.updateComplete;
  for (const badge of allBadges(el)) await badge.updateComplete;
}

function expectOverCorner(badge: WtHelpTooltip, box: HTMLElement): void {
  const at = badge.getBoundingClientRect();
  const corner = box.getBoundingClientRect();
  expect(at.width).toBeGreaterThan(0);
  expect(at.left + at.width / 2).toBeCloseTo(corner.right, 0);
  expect(at.top + at.height / 2).toBeCloseTo(corner.top, 0);
}

const size = (box: HTMLElement) => {
  const { width, height } = box.getBoundingClientRect();
  return { width, height };
};

async function expectText(badge: WtHelpTooltip, key: HelpKey): Promise<void> {
  expect(badge.mode).toBe("help-mode");
  expect(badge.textContent).toBe(helpEn[key]);
  await userEvent.click(badge.shadowRoot!.querySelector("button")!);
  expect(isOpen(badge)).toBe(true);
}

async function tapMoving(el: TillFloorScreen, id: string): Promise<void> {
  el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
    new CustomEvent("wt-table-tap", { detail: { tableId: id }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

describe("Floor's help badges", () => {
  it("with help on, the toolbar's badge explains the map", async () => {
    const { el } = await mount();
    await helpOn(el);
    const badge = toolbarBadge(el)!;
    expectOverCorner(badge, actions(el));
    await expectText(badge, "help.floor.tables_map");
  });

  it("with help on, the toolbar's badge explains the map without dragging when today's plan cannot be changed", async () => {
    const { el } = await mount({ canChangeToday: false });
    await helpOn(el);
    await expectText(toolbarBadge(el)!, "help.floor.tables_map_view");
  });

  it("with help on, the toolbar's badge explains the list in list view", async () => {
    for (const canChangeToday of [true, false]) {
      const { el } = await mount({ canChangeToday });
      await toggleFloorView(el);
      await helpOn(el);
      const badge = toolbarBadge(el)!;
      expectOverCorner(badge, actions(el));
      await expectText(badge, "help.floor.tables_list");
      cleanupWidgets();
    }
  });

  it("says each floor text in Spanish", async () => {
    setLocale("es");
    const { el } = await mount({ zones: [zone(dinner)] });
    await helpOn(el);
    expect(toolbarBadge(el)!.textContent).toBe(helpEs["help.floor.tables_map"]);
    expect(bannerBadge(el)!.textContent).toBe(helpEs["help.floor.layout_due"]);
    await toggleFloorView(el);
    expect(toolbarBadge(el)!.textContent).toBe(helpEs["help.floor.tables_list"]);
    el.canChangeToday = false;
    await toggleFloorView(el);
    expect(toolbarBadge(el)!.textContent).toBe(helpEs["help.floor.tables_map_view"]);
  });

  it("at 390 the toolbar's badge is there and inside the window", async () => {
    await page.viewport(390, 844);
    const { el } = await mount();
    const off = actions(el).getBoundingClientRect();
    await helpOn(el);
    const badge = toolbarBadge(el)!;
    expectOverCorner(badge, actions(el));
    const at = badge.getBoundingClientRect();
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.right).toBeLessThanOrEqual(window.innerWidth);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(actions(el).getBoundingClientRect().toJSON()).toEqual(off.toJSON());
  });

  it("the layout banner has a badge, and the banner is the same size with help off and on", async () => {
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      const { el } = await mount({ zones: [zone(dinner)] });
      const off = size(banner(el));
      await helpOn(el);
      const badge = bannerBadge(el)!;
      expectOverCorner(badge, banner(el));
      expect(size(banner(el))).toEqual(off);
      expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      await expectText(badge, "help.floor.layout_due");
      setHelpMode(false);
      cleanupWidgets();
    }
  });

  it("the Needs moving dialog's heading has a badge when it offers Leave it here, and none when it does not", async () => {
    const { el } = await mount({ tables: [planned("t3", 12, { needsMoving: true })] });
    await helpOn(el);
    await tapMoving(el, "t3");
    const dialog = moveDialog(el)!;
    expect(dialog.querySelector("[data-leave-here]")).not.toBeNull();
    const badge = badgeFor(dialog, t("floor.needs_moving"))!;
    expect(badge.slot).toBe("help");
    await expectText(badge, "help.floor.needs_moving");

    dialog.querySelector<HTMLElement>("[data-move-cancel]")!.click();
    el.canChangeToday = false;
    await el.updateComplete;
    await tapMoving(el, "t3");
    expect(moveDialog(el)!.querySelector("[data-leave-here]")).toBeNull();
    expect(moveDialog(el)!.querySelector("wt-help-tooltip")).toBeNull();
  });

  it("the Needs clearing dialog has no badge", async () => {
    const { el } = await mount({
      tables: [{ ...planned("t3", 12), condition: "needs_clearing" }],
    });
    await helpOn(el);
    await tapMoving(el, "t3");
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-clear-dialog] wt-help-tooltip")).toBeNull();
  });

  it("a tap on a table still opens it with help on", async () => {
    const seated = { ...planned("t2", 12), state: "open-tab" as const, hasOpenTab: true };
    const { el } = await mount({ tables: [planned("t1", 2), seated] });
    const opened: unknown[] = [];
    el.addEventListener("open-table", (event) => opened.push((event as CustomEvent).detail));
    await helpOn(el);
    const map = el.shadowRoot!.querySelector("wt-floor-map")!;
    const shape = await vi.waitFor(() => {
      const found = map.shadowRoot!.querySelector<HTMLElement>(
        '[part="table"][data-table-id="t2"] [part="shape"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    await userEvent.click(shape);
    await vi.waitFor(() => expect(opened).toEqual([{ tableId: "t2", seated: true }]));

    await toggleFloorView(el);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).not.toBeNull();
  });

  it("help off: no badges", async () => {
    const { el } = await mount({
      zones: [zone(dinner)],
      tables: [planned("t3", 12, { needsMoving: true })],
    });
    await tapMoving(el, "t3");
    const badges = allBadges(el);
    expect(badges).toHaveLength(3);
    for (const badge of badges) {
      await badge.updateComplete;
      expect(badge.getBoundingClientRect().width).toBe(0);
    }
  });
});
