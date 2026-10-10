import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FLOOR_MAP_FILLS, type FloorMapFill } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./table-status.js";
import type { TillTableStatus } from "./table-status.js";
import type { TableParty, TableState } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const party: TableParty = {
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
    today: null,
    signals: [],
    party,
    ...over,
  };
}

const seated = { state: "open-tab" as const, condition: "held" as const, hasOpenTab: true };

const forFill: Record<FloorMapFill, TableState> = {
  free: table(),
  reserved: table({ nextReservation: { time: "20:30" } }),
  seated: table({ ...seated, pendingToServe: 2 }),
  bill: table({
    ...seated,
    signals: [{ kind: "bill_requested", requestedAt: "2026-10-10T11:00:00Z" }],
  }),
  clearing: table({ condition: "needs_clearing" }),
};

describe.each(["light", "dark"] as const)("till-table-status a11y (%s theme)", (theme) => {
  it.each(FLOOR_MAP_FILLS.map((fill) => [fill] as const))(
    "has no violations for the %s pin",
    async (fill) => {
      const { el, host } = await mountWidget<TillTableStatus>(
        "till-table-status",
        { party, tables: [forFill[fill]] },
        theme,
      );
      expect(
        el.shadowRoot!.querySelector(`[data-status-pin] [data-fill="${fill}"]`),
      ).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );

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
