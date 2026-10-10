import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./table-status.js";
import type { TillTableStatus } from "./table-status.js";
import type { TillTableDetailsSheet } from "./table-details-sheet.js";
import type { TableParty, TableState } from "../api/client.js";
import type { WtToast } from "@waitron/ui";

afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
});
beforeEach(() => setLocale("en"));

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "p1",
    revision: 1,
    guestCount: null,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t4",
    label: "4",
    zoneId: "z1",
    capacity: null,
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
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

/** A seated row of `of`. */
const row = (of: TableParty, over: Partial<TableState> = {}) => table({ party: of, ...over });

const billRequested = { kind: "bill_requested" as const, requestedAt: "2026-10-10T11:00:00Z" };

async function mount(over: Partial<TillTableStatus> = {}) {
  return mountWidget<TillTableStatus>("till-table-status", over);
}

const pin = (el: TillTableStatus) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>("[data-status-pin]");
const toast = (el: TillTableStatus) =>
  el.shadowRoot!.querySelector<WtToast>("wt-toast[data-flash-notice]");
const sheet = (el: TillTableStatus) =>
  el.shadowRoot!.querySelector<TillTableDetailsSheet>("till-table-details-sheet");
const toastMessage = (el: TillTableStatus) =>
  toast(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button.message");

async function settled(el: TillTableStatus): Promise<void> {
  await el.updateComplete;
  const notice = toast(el);
  if (notice) await notice.updateComplete;
}

function closed(target: EventTarget): Promise<void> {
  return new Promise((resolve) =>
    target.addEventListener("wt-close", () => resolve(), { once: true }),
  );
}

describe("till-table-status", () => {
  it("draws nothing without a party or without its table", async () => {
    const p = party();
    const { el } = await mount({ party: null, tables: [row(p)] });
    expect(el.shadowRoot!.children.length).toBe(0);
    el.party = p;
    el.tables = [row(party({ id: "p2" }))];
    await el.updateComplete;
    expect(el.shadowRoot!.children.length).toBe(0);
  });

  it("pins the table's status in its colour and shortest word", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { readyToServe: 2 })] });
    expect(pin(el)!.textContent!.trim()).toBe("2 ready");
    expect(pin(el)!.querySelector("[data-fill]")!.getAttribute("data-fill")).toBe("seated");
    expect(pin(el)!.getAttribute("aria-label")).toBe("Table details: 2 ready");
  });

  it("reads a merge's pin from all of the party's tables, in its table order", async () => {
    const p = party({ tableIds: ["t5", "t4"] });
    const { el } = await mount({
      party: p,
      tables: [
        table({ id: "t9", state: "free", condition: "free", hasOpenTab: false }),
        row(p, { id: "t3" }),
        row(p, { id: "t4", pendingToServe: 3 }),
        row(p, { id: "t5", pendingToServe: 3, signals: [billRequested] }),
        row(party({ id: "p2" }), { id: "t6", readyToServe: 9 }),
      ],
    });
    expect(pin(el)!.textContent!.trim()).toBe("Bill requested");
    expect(pin(el)!.querySelector("[data-fill]")!.getAttribute("data-fill")).toBe("bill");
    pin(el)!.click();
    await el.updateComplete;
    expect(sheet(el)!.table!.id).toBe("t5");
  });

  it("is at least a tap tall", async () => {
    const p = party();
    const { el, host } = await mount({ party: p, tables: [row(p)] });
    const probe = document.createElement("div");
    probe.style.height = "var(--wt-tap-min)";
    host.appendChild(probe);
    expect(pin(el)!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      probe.getBoundingClientRect().height,
    );
    expect(probe.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it("paints the pin's swatch from the fill's token", async () => {
    const p = party();
    const { el, host } = await mount({ party: p, tables: [row(p)] });
    host.style.setProperty("--wt-color-table-seated", "rgb(1, 2, 3)");
    const swatch = pin(el)!.querySelector<HTMLElement>("[data-fill]")!;
    expect(getComputedStyle(swatch).backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("the pin opens the details sheet, headed with the party's name", async () => {
    const p = party({ name: null, displayName: "Terrace 4, 5", tableIds: ["t4", "t5"] });
    const { el } = await mount({
      party: p,
      tables: [row(p, { id: "t4" }), row(p, { id: "t5" })],
    });
    expect(sheet(el)!.table).toBeNull();
    pin(el)!.click();
    await el.updateComplete;
    expect(sheet(el)!.table!.id).toBe("t4");
    expect(sheet(el)!.heading).toBe("Terrace 4, 5");
  });

  it("Close closes the pin's sheet", async () => {
    const p = party();
    const { el, host } = await mount({ party: p, tables: [row(p)] });
    const escaped: Event[] = [];
    host.addEventListener("details-close", (event) => escaped.push(event));
    pin(el)!.click();
    await el.updateComplete;
    await sheet(el)!.updateComplete;
    const dialog = sheet(el)!.shadowRoot!.querySelector("wt-dialog")!;
    const gone = closed(dialog);
    sheet(el)!.shadowRoot!.querySelector<HTMLElement>("[data-details-close]")!.click();
    await el.updateComplete;
    await gone;
    expect(sheet(el)!.table).toBeNull();
    expect(escaped).toEqual([]);
  });

  it("does not reopen the sheet for the next party after its table went", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p)] });
    pin(el)!.click();
    await el.updateComplete;
    expect(sheet(el)!.table).not.toBeNull();
    el.tables = [];
    await el.updateComplete;
    const next = party({ id: "p3", tableIds: ["t-p3"] });
    el.party = next;
    el.tables = [row(next, { id: "t-p3" })];
    await el.updateComplete;
    expect(sheet(el)!.table).toBeNull();
  });

  it("does not open the sheet for another party drawn while it is open", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p)] });
    pin(el)!.click();
    await el.updateComplete;
    const next = party({ id: "p3", tableIds: ["t-p3"] });
    el.party = next;
    el.tables = [row(next, { id: "t-p3" })];
    await el.updateComplete;
    expect(sheet(el)!.table).toBeNull();
  });

  it("a re-read updates the pin's sheet", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { readyToServe: 1 })] });
    pin(el)!.click();
    await el.updateComplete;
    const reread = row(p, { readyToServe: 3 });
    el.tables = [reread];
    await el.updateComplete;
    expect(sheet(el)!.table).toBe(reread);
    expect(pin(el)!.textContent!.trim()).toBe("3 ready");
  });

  it("flashes what the waiter must see when the order opens", async () => {
    const p = party();
    const { el } = await mount({
      party: p,
      tables: [row(p, { readyToServe: 2, signals: [billRequested] })],
    });
    await settled(el);
    expect(toast(el)!.open).toBe(true);
    expect(toast(el)!.message).toBe("2 ready to serve · Bill requested");
    expect(toast(el)!.tone).toBe("info");
  });

  it("says one dish ready, and a merge's ready dishes once", async () => {
    const p = party({ tableIds: ["t4", "t5"] });
    const { el } = await mount({
      party: p,
      tables: [row(p, { id: "t4", readyToServe: 1 }), row(p, { id: "t5", readyToServe: 1 })],
    });
    await settled(el);
    expect(toast(el)!.message).toBe("1 ready to serve");
  });

  it("says a forgotten order", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { timingBand: "forgotten" })] });
    await settled(el);
    expect(toast(el)!.open).toBe(true);
    expect(toast(el)!.message).toBe("Forgotten order");
  });

  it("flashes nothing when nothing is urgent", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { pendingToServe: 2 })] });
    await settled(el);
    expect(toast(el)!.open).toBe(false);
  });

  it("the notice goes on its own after 4 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { readyToServe: 2 })] });
    await settled(el);
    vi.advanceTimersByTime(3_999);
    expect(toast(el)!.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast(el)!.open).toBe(false);
  });

  it("the notice goes with a tap", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { readyToServe: 2 })] });
    await settled(el);
    toastMessage(el)!.click();
    expect(toast(el)!.open).toBe(false);
  });

  it("the notice blocks nothing", async () => {
    const p = party();
    const { el, host } = await mount({ party: p, tables: [row(p, { readyToServe: 2 })] });
    const beside = document.createElement("button");
    beside.textContent = "beside";
    beside.style.position = "fixed";
    beside.style.top = "50vh";
    beside.style.left = "50vw";
    host.appendChild(beside);
    await settled(el);
    expect(toast(el)!.open).toBe(true);
    expect(el.shadowRoot!.querySelector("dialog[open]")).toBeNull();
    const box = beside.getBoundingClientRect();
    expect(document.elementFromPoint(box.left + 2, box.top + 2)).toBe(beside);
  });

  it("does not flash again for the same party, and does for another", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [row(p, { readyToServe: 2 })] });
    await settled(el);
    toastMessage(el)!.click();
    expect(toast(el)!.open).toBe(false);

    const same = party();
    el.party = same;
    el.tables = [row(same, { readyToServe: 2 })];
    await settled(el);
    expect(toast(el)!.open).toBe(false);

    const other = party({ id: "p2" });
    el.party = other;
    el.tables = [row(other, { timingBand: "forgotten" })];
    await settled(el);
    expect(toast(el)!.open).toBe(true);
    expect(toast(el)!.message).toBe("Forgotten order");
  });

  it("flashes a party whose table arrives in a later read", async () => {
    const p = party();
    const { el } = await mount({ party: p, tables: [] });
    expect(toast(el)).toBeNull();
    el.tables = [row(p, { readyToServe: 2 })];
    await settled(el);
    expect(toast(el)!.open).toBe(true);
  });

  it("flashes the same party again after being put back on the page", async () => {
    const p = party();
    const { el, host } = await mount({ party: p, tables: [row(p, { readyToServe: 2 })] });
    await settled(el);
    toastMessage(el)!.click();
    el.remove();
    host.appendChild(el);
    await settled(el);
    expect(toast(el)!.open).toBe(true);
  });
});
