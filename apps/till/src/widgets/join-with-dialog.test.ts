import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./join-with-dialog.js";
import type { TillJoinWithDialog } from "./join-with-dialog.js";
import type { TableParty, TableState } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function table(id: string, over: Partial<TableState> = {}): TableState {
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
    today: null,
    signals: [],
    party: null,
    ...over,
  };
}

const ana: TableParty = {
  id: "P",
  revision: 1,
  guestCount: 2,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: null,
  outstanding: "0.00",
  billCount: 1,
  tableIds: ["t3"],
  unsentDrafts: [],
  reminder: null,
};

async function mount(over: Partial<TillJoinWithDialog> = {}): Promise<TillJoinWithDialog> {
  const { el } = await mountWidget<TillJoinWithDialog>("till-join-with-dialog", {
    table: table("t1"),
    heading: "Join 1 with",
    targets: [
      table("t2"),
      table("t3", { label: "3", state: "open-tab", condition: "held", party: ana }),
      table("t4", { label: "4+5" }),
      table("t6", { condition: "needs_clearing" }),
    ],
    ...over,
  });
  return el;
}

const dialogOf = (el: TillJoinWithDialog) => el.shadowRoot!.querySelector("wt-dialog")!;
const rows = (el: TillJoinWithDialog) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-target]")].map((button) => ({
    id: button.dataset.target,
    text: button.textContent!.replace(/\s+/g, " ").trim(),
    disabled: (button as HTMLElementTagNameMap["wt-button"]).disabled,
  }));

function captured(el: TillJoinWithDialog) {
  const seen: unknown[] = [];
  el.addEventListener("join-with-pick", (event) =>
    seen.push({ pick: (event as CustomEvent).detail }),
  );
  el.addEventListener("join-with-close", () => seen.push("close"));
  return seen;
}

it("lists the zone's other tables with their condition and sends the pick", async () => {
  const el = await mount();
  const seen = captured(el);
  expect(dialogOf(el).open).toBe(true);
  expect(dialogOf(el).heading).toBe("Join 1 with");
  expect(rows(el)).toEqual([
    { id: "t2", text: "2 Free", disabled: false },
    { id: "t3", text: "3 Seated: Ana", disabled: false },
    { id: "t4", text: "4+5 Free", disabled: false },
    { id: "t6", text: "6 Needs clearing", disabled: true },
  ]);

  el.shadowRoot!.querySelector<HTMLElement>('[data-target="t3"]')!.click();

  expect(seen).toEqual([{ pick: { tableId: "t1", targetId: "t3" } }, "close"]);
});

it("says so when there is no other table", async () => {
  const el = await mount({ targets: [] });
  expect(rows(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-no-targets]")!.textContent!.trim()).toBe(
    "No other tables",
  );
});

it("Cancel asks to close", async () => {
  const el = await mount();
  const seen = captured(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-join-with-cancel]")!.click();
  expect(seen).toEqual(["close"]);
});

it("closes on Escape", async () => {
  const el = await mount();
  const seen = captured(el);
  const closed = new Promise((resolve) =>
    dialogOf(el).addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(seen).toEqual(["close"]);
});

it("asks nothing when its table is taken away", async () => {
  const el = await mount();
  const seen = captured(el);
  const closed = new Promise((resolve) =>
    dialogOf(el).addEventListener("wt-close", resolve, { once: true }),
  );
  el.table = null;
  await closed;
  expect(dialogOf(el).open).toBe(false);
  expect(seen).toEqual([]);
});

it("stays closed, and asks nothing, without a table", async () => {
  const el = await mount({ table: null });
  const seen = captured(el);
  expect(dialogOf(el).open).toBe(false);
  expect(rows(el)).toEqual([]);
  expect(seen).toEqual([]);
});
