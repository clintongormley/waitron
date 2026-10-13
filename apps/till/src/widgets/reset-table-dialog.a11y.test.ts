import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TableState, TableToday } from "../api/client.js";
import "./reset-table-dialog.js";
import type { TillResetTableDialog } from "./reset-table-dialog.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));

function today(seats: number, over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 0, y: 0, width: 2, height: 2, shape: "rect", rotation: 0 },
    seats,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}
function table(id: string, label: string, todayRow: TableToday): TableState {
  return {
    id,
    label,
    zoneId: "z1",
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
    today: todayRow,
    signals: [],
    party: null,
  };
}
const joined = table(
  "long",
  "Long table",
  today(2, { joined: { parts: ["c3"], splitOff: ["c4", "c5"], apart: true } }),
);
const apart = [
  {
    table: table("c5", "Counter 5", today(4, { splitOffFrom: "long" })),
    reason: "guests" as const,
  },
  { table: table("c4", "Counter 4", today(6, { splitOffFrom: "long" })), reason: "food" as const },
];

async function typeSeats(el: TillResetTableDialog, value: string) {
  const input = el
    .shadowRoot!.querySelector("wt-number-stepper")!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("till-reset-table-dialog a11y (%s theme)", (theme) => {
  async function mount() {
    setLocale("es-ES");
    return mountWidget<TillResetTableDialog>("till-reset-table-dialog", { joined, apart }, theme);
  }

  it("has no violations empty, and with seats typed", async () => {
    const { el, host } = await mount();
    await expectNoA11yViolations(host);
    await typeSeats(el, "8");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the seats error", async () => {
    const { el, host } = await mount();
    await typeSeats(el, "1000");
    el.shadowRoot!.querySelector<HTMLElement>("[data-reset-table-action]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-number-stepper")!.error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal at the foot", async () => {
    const { el, host } = await mount();
    await typeSeats(el, "8");
    el.refusal = { code: "joined_table.out_of_date" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
    await expectNoA11yViolations(host);
  });
});
