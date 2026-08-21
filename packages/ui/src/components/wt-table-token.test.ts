import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { FloorTable } from "../floor.js";
import "./wt-table-token.js";

afterEach(cleanup);

function table(overrides: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    label: "4",
    capacity: 4,
    posX: 500,
    posY: 500,
    shape: "square",
    rotation: 0,
    zoneId: null,
    state: "free",
    pendingToServe: 0,
    status: null,
    ...overrides,
  };
}

async function mountToken(t: FloorTable, labels?: unknown): Promise<HTMLElement> {
  const el = (await mount("<wt-table-token></wt-table-token>")) as HTMLElement & {
    table: FloorTable;
    labels?: unknown;
    updateComplete: Promise<unknown>;
  };
  el.table = t;
  if (labels) el.labels = labels;
  await el.updateComplete;
  return el;
}

test("renders the table label", async () => {
  const el = await mountToken(table({ label: "12" }));
  expect(el.shadowRoot!.querySelector(".label")?.textContent?.trim()).toBe("12");
});

test("carries the FP-1 state class so its accent colour matches the list card", async () => {
  const el = await mountToken(table({ state: "open-tab" }));
  expect(el.shadowRoot!.querySelector(".card")?.classList.contains("state-open-tab")).toBe(true);
});

test("shows an open tab's running total with the euro sign", async () => {
  const el = await mountToken(table({ state: "open-tab", tabTotal: "47.50" }));
  const total = el.shadowRoot!.querySelector(".occupancy .total");
  expect(total?.textContent?.trim()).toBe("47.50 €");
});

test("a free table shows no tab total", async () => {
  const el = await mountToken(table({ state: "free" }));
  expect(el.shadowRoot!.querySelector(".total")).toBeNull();
});

test("an open tab with no total yet shows no total line", async () => {
  const el = await mountToken(table({ state: "open-tab", tabTotal: null }));
  expect(el.shadowRoot!.querySelector(".total")).toBeNull();
});

test("a delivery-pending table shows no tab total", async () => {
  const el = await mountToken(table({ state: "delivery-pending" }));
  expect(el.shadowRoot!.querySelector(".total")).toBeNull();
});

test("shows the to-serve badge with its count only when something is pending", async () => {
  const pending = await mountToken(table({ pendingToServe: 3 }), { toServe: "por servir" });
  const badge = pending.shadowRoot!.querySelector(".badge.to-serve");
  expect(badge?.textContent?.replace(/\s+/g, " ").trim()).toBe("3 por servir");

  const none = await mountToken(table({ pendingToServe: 0 }));
  expect(none.shadowRoot!.querySelector(".badge.to-serve")).toBeNull();
});

test("shows the manual status badge with its DATA colour, mirroring FP-1", async () => {
  const el = await mountToken(
    table({ status: { id: "s1", label: "Reservada", color: "rgb(10, 20, 30)" } }),
  );
  const badge = el.shadowRoot!.querySelector<HTMLElement>(".badge.status")!;
  const dot = badge.querySelector<HTMLElement>(".dot")!;
  expect(badge.textContent?.trim()).toBe("Reservada");
  // The arbitrary status colour rides on an inline style (never chrome CSS), exactly as FP-1's card.
  expect(badge.style.borderColor).toBe("rgb(10, 20, 30)");
  expect(dot.style.background).toBe("rgb(10, 20, 30)");
});

test("renders the covers count, with an optional localisable suffix", async () => {
  const bare = await mountToken(table({ capacity: 6 }));
  expect(bare.shadowRoot!.querySelector(".capacity")?.textContent?.trim()).toBe("6");

  const suffixed = await mountToken(table({ capacity: 6 }), { covers: "plazas" });
  expect(
    suffixed.shadowRoot!.querySelector(".capacity")?.textContent?.replace(/\s+/g, " ").trim(),
  ).toBe("6 plazas");
});

test("omits the covers line when capacity is unknown", async () => {
  const el = await mountToken(table({ capacity: null }));
  expect(el.shadowRoot!.querySelector(".capacity")).toBeNull();
});

test("the state accent paints from the success token for a free table", async () => {
  const el = await mountToken(table({ state: "free" }));
  host.style.setProperty("--wt-color-success", "rgb(1, 2, 3)");
  const card = el.shadowRoot!.querySelector(".card")!;
  expect(getComputedStyle(card).borderLeftColor).toBe("rgb(1, 2, 3)");
});

// The stored table shape must render DISTINCTLY (Copilot: round/square/rect changed the enum but nothing
// visual — a dead control). Each shape maps to its own class and a distinct, token-driven corner radius.
test("renders each table shape as a distinct class and corner radius", async () => {
  const round = await mountToken(table({ shape: "round" }));
  const square = await mountToken(table({ shape: "square" }));
  const rect = await mountToken(table({ shape: "rect" }));
  const cardOf = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLElement>(".card")!;
  expect(cardOf(round).classList.contains("shape-round")).toBe(true);
  expect(cardOf(square).classList.contains("shape-square")).toBe(true);
  expect(cardOf(rect).classList.contains("shape-rect")).toBe(true);
  // The three classes resolve to three DIFFERENT radii (round = full/pill, square = sm, rect = md),
  // proving the shape is a live visual and not just a class name.
  const radiusOf = (el: HTMLElement) => getComputedStyle(cardOf(el)).borderTopLeftRadius;
  expect(new Set([radiusOf(round), radiusOf(square), radiusOf(rect)]).size).toBe(3);
});

test("an unplaced (shapeless) token falls back to the rounded-rect shape", async () => {
  // A tray token carries no shape (null); it keeps the default rounded rect it drew before, so the
  // tray is visually unchanged by the shape work.
  const bare = await mountToken(table({ shape: null }));
  expect(bare.shadowRoot!.querySelector(".card")!.classList.contains("shape-rect")).toBe(true);
});
