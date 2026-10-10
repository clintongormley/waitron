import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./floor-zone-menu.js";
import type { TillFloorZoneMenu } from "./floor-zone-menu.js";
import type { TableState, TableToday } from "../api/client.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));

function table(id: string, over: Partial<TableToday> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    capacity: 4,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    today: {
      placement: null,
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      ...over,
    },
    signals: [],
    party: null,
  };
}

const zone = {
  id: "z1",
  name: "Terraza",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
};

async function mount(theme: "light" | "dark", tables: TableState[]) {
  setLocale("es-ES");
  return mountWidget<TillFloorZoneMenu>("till-floor-zone-menu", { zone, tables }, theme);
}

async function open(el: TillFloorZoneMenu, item: string, dialog: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-menu-item="${item}"]`)!.click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
      `wt-dialog[data-dialog="${dialog}"]`,
    )!.open,
  ).toBe(true);
}

describe.each(["light", "dark"] as const)("till-floor-zone-menu a11y (%s theme)", (theme) => {
  const tables = [table("t9"), table("t3", { takenOff: true })];

  it("has no violations with the menu open", async () => {
    const { el, host } = await mount(theme, tables);
    const menu =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!;
    menu.show();
    await menu.updateComplete;
    await expectNoA11yViolations(host);
  });

  for (const [item, dialog] of [
    ["spares", "spares"],
    ["taken-off", "taken-off"],
    ["reset", "reset"],
  ] as const)
    it(`has no violations with the ${dialog} dialog open`, async () => {
      const { el, host } = await mount(theme, tables);
      await open(el, item, dialog);
      await expectNoA11yViolations(host);
    });

  it("has no violations with both lists empty", async () => {
    const { el, host } = await mount(theme, []);
    await open(el, "spares", "spares");
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>('[data-dialog="spares"] [data-cancel]')!.click();
    await el.updateComplete;
    await open(el, "taken-off", "taken-off");
    await expectNoA11yViolations(host);
  });
});
