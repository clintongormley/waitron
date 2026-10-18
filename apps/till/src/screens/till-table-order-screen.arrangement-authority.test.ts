import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import type { BillEditExpected } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { beer, flan, mount, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(async () => {
  setLocale("en");
  await page.viewport(1280, 1800);
});
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale("en");
});
const observation: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 2,
  draftId: "draft",
  draftRevision: 3,
};
const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
async function open() {
  const draft = new DraftStore();
  draft.loadFrom("draft", [
    {
      product: beer,
      quantity: "2",
      place: { kind: "fire" },
      source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
    },
    { product: flan, quantity: "1", place: { kind: "new", slot: 1 } },
    {
      product: { ...flan, id: "pie", name: "Pie" },
      quantity: "1",
      place: { kind: "new", slot: 2 },
    },
  ]);
  const { el } = await mount({
    draftStore: draft,
    currentOrders: current(),
    groups,
    now,
    billEdit: { ...observation },
  });
  el.style.width = "1280px";
  await resized(el);
  return { el, draft };
}
function point(target: HTMLElement) {
  const box = target.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
function pointer(target: EventTarget, type: string, at: { x: number; y: number }) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 61,
      pointerType: "touch",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}
async function prepare(el: TillTableOrderScreen, kind: "drag" | "heading" | "move") {
  if (kind === "drag") {
    const lead = q(el, '[data-draft-select="0"]');
    const at = point(lead);
    vi.useFakeTimers();
    pointer(lead, "pointerdown", at);
    await vi.advanceTimersByTimeAsync(500);
    const target = point(q(el, '[data-draft-group="new:2"] h3'));
    pointer(window, "pointermove", target);
    return () => {
      pointer(window, "pointerup", target);
      vi.useRealTimers();
    };
  }
  if (kind === "heading") {
    const menu = q(el, '[data-draft-group-more="new:1"]') as WtRowActions;
    await menu.updateComplete;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
    const action = menu.querySelector<HTMLElement>("[data-draft-later]")!;
    expect(action).not.toBeNull();
    return () => action.click();
  }
  await userEvent.click(q(el, '[data-draft-select="0"]'));
  await el.updateComplete;
  await userEvent.click(q(el, "[data-draft-move]"));
  await el.updateComplete;
  const action = q(el, '[data-draft-move-to="new:2"]');
  expect(action).not.toBeNull();
  return () => action.click();
}
function snapshot(draft: DraftStore) {
  return structuredClone(draft.lines);
}

for (const kind of ["drag", "heading", "move"] as const) {
  it.each(["billId", "editorVersion", "draftId", "draftRevision", "missing"] as const)(
    `an open ${kind} leaves the candidate intact when its %s changes before rendering`,
    async (field) => {
      const { el, draft } = await open();
      const activate = await prepare(el, kind);
      const before = snapshot(draft);
      const originals = [...draft.lines];
      const writes = vi.fn();
      el.addEventListener("submit-draft", writes);
      el.billEdit =
        field === "missing"
          ? null
          : {
              ...observation,
              ...(field === "billId" ? { billId: "other" } : {}),
              ...(field === "editorVersion" ? { editorVersion: 4 } : {}),
              ...(field === "draftId" ? { draftId: "new-draft" } : {}),
              ...(field === "draftRevision" ? { draftRevision: 5 } : {}),
            };
      activate();
      expect(draft.lines).toEqual(before);
      expect(draft.lines.every((line, i) => line === originals[i])).toBe(true);
      expect(writes).not.toHaveBeenCalled();
    },
  );

  it(`an equivalent observation keeps an open ${kind} usable regardless of key order`, async () => {
    const { el, draft } = await open();
    const activate = await prepare(el, kind);
    const source = draft.lines[0]!.source;
    el.billEdit = { draftRevision: 3, draftId: "draft", editorVersion: 2, billId: "wo-4" };
    activate();
    expect(draft.lines.map((line) => line.place)).toEqual(
      kind === "heading"
        ? [{ kind: "fire" }, { kind: "new", slot: 2 }, { kind: "new", slot: 1 }]
        : [
            { kind: "new", slot: 2 },
            { kind: "new", slot: 1 },
            { kind: "new", slot: 2 },
          ],
    );
    expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "1"]);
    expect(draft.lines[0]!.source).toBe(source);
  });
}

it.each([
  "api",
  "party",
  "bill",
  "visit",
  "revision",
  "draft",
  "selection",
  "busy",
  "unread",
  "ordering",
  "disconnected",
] as const)(
  "an open Move to picker cannot apply to a changed %s before rendering",
  async (change) => {
    const { el, draft } = await open();
    const activate = await prepare(el, "move");
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
    if (change === "bill") el.orderId = "other";
    if (change === "visit") el.serviceVisit++;
    if (change === "revision") el.currentOrders = { ...current(), revision: 8 };
    if (change === "draft") draft.setLineQuantity(1, "3");
    if (change === "selection") q(el, '[data-draft-select="0"]').click();
    if (change === "busy") el.busy = true;
    if (change === "unread") el.currentOrdersUnread = true;
    if (change === "ordering") el.orderingAllowed = false;
    if (change === "disconnected") el.remove();
    const before = snapshot(draft);
    activate();
    expect(draft.lines).toEqual(before);
  },
);

it("a changed selection cannot add a different dish to an already-open Move to choice", async () => {
  const { el, draft } = await open();
  const activate = await prepare(el, "move");
  q(el, '[data-draft-select="1"]').click();
  const before = snapshot(draft);
  activate();
  expect(draft.lines).toEqual(before);
});

it("a new ownership observation closes the old Move to window after rendering", async () => {
  const { el, draft } = await open();
  const activate = await prepare(el, "move");
  const before = snapshot(draft);
  el.billEdit = { ...observation, editorVersion: 4 };
  await el.updateComplete;
  expect(q(el, "[data-draft-move-dialog]").hasAttribute("open")).toBe(false);
  activate();
  expect(draft.lines).toEqual(before);
});

it("a changed ownership observation removes the pending drag highlight after rendering", async () => {
  const { el, draft } = await open();
  const activate = await prepare(el, "drag");
  const before = snapshot(draft);
  el.billEdit = { ...observation, editorVersion: 4 };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-draft-dragging]")).toBeNull();
  activate();
  expect(draft.lines).toEqual(before);
});

it("an identical service and editor read leaves an open Move to choice usable", async () => {
  const { el, draft } = await open();
  const activate = await prepare(el, "move");
  el.currentOrders = structuredClone(current());
  el.groups = structuredClone(groups);
  el.billEdit = { ...observation };
  await el.updateComplete;
  expect(q(el, "[data-draft-move-dialog]").hasAttribute("open")).toBe(true);
  activate();
  expect(draft.lines[0]!.place).toEqual({ kind: "new", slot: 2 });
});
