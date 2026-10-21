import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FloorMapFill } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./table-status.js";
import type { TillTableStatus } from "./table-status.js";
import type { TableParty, TableState } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const party: TableParty = {
  kitchenNote: { scope: { partyId: "p1" }, note: null, revision: 0, ownerRevision: 1 },
  id: "p1",
  revision: 1,
  guestCount: 4,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: null,
  outstanding: "47.50",
  billCount: 1,
  tableIds: ["t1"],
  unsentDrafts: [],
  reminder: null,
};

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "4",
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party,
    ...over,
  };
}

const seated = { state: "open-tab" as const, condition: "held" as const, hasOpenTab: true };

/**
 * Every fill `pinLook` gives a table that carries the pin's party; free, reserved and plain need a
 * table with no party, which the pin never draws.
 */
const forFill = {
  danger: table({ ...seated, timingBand: "forgotten" }),
  warning: table({
    ...seated,
    signals: [{ kind: "held_unavailable", groupId: "g1", lineNames: ["Steak"] }],
  }),
  bill: table({
    ...seated,
    signals: [{ kind: "bill_requested", requestedAt: "2026-10-10T11:00:00Z" }],
  }),
  ready: table({ ...seated, readyToServe: 2 }),
  seated: table({ ...seated, signals: [{ kind: "take_order" }] }),
  calm: table({ ...seated, pendingToServe: 2 }),
} satisfies Partial<Record<FloorMapFill, TableState>>;

const PIN_FILLS = Object.keys(forFill) as (keyof typeof forFill)[];

describe.each(["light", "dark"] as const)("till-table-status a11y (%s theme)", (theme) => {
  it.each(PIN_FILLS)("has no violations for the %s pin", async (fill) => {
    const { el, host } = await mountWidget<TillTableStatus>(
      "till-table-status",
      { party, tables: [forFill[fill]] },
      theme,
    );
    expect(el.shadowRoot!.querySelector(`[data-status-pin] [data-fill="${fill}"]`)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations with an overdue pin and its icon", async () => {
    const { el, host } = await mountWidget<TillTableStatus>(
      "till-table-status",
      { party, tables: [table({ ...seated, signals: [{ kind: "long_wait", band: "overdue" }] })] },
      theme,
    );
    expect(
      el.shadowRoot!.querySelector(
        '[data-status-pin] [data-fill="calm"] ~ wt-icon[name="floor-timer"]',
      ),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations with the notice open", async () => {
    const { el, host } = await mountWidget<TillTableStatus>(
      "till-table-status",
      { party, tables: [table({ ...seated, readyToServe: 2, timingBand: "forgotten" })] },
      theme,
    );
    const notice = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "wt-toast[data-flash-notice]",
    )!;
    await (notice as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(notice.open).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the sheet open from the pin", async () => {
    const { el, host } = await mountWidget<TillTableStatus>(
      "till-table-status",
      { party, tables: [table({ ...seated, pendingToServe: 2 })] },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLButtonElement>("[data-status-pin]")!.click();
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-table-details-sheet",
    )!;
    await sheet.updateComplete;
    expect(sheet.shadowRoot!.querySelector("wt-dialog")!.hasAttribute("open")).toBe(true);
    await expectNoA11yViolations(host);
  });
});
