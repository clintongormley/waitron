import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BillEditExpected, DeadEndAnswer, TillApi } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, flan, mount, store } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

interface Check {
  sent: readonly OrderLine[];
  checkId: number;
  automatic: boolean;
}
const expected: BillEditExpected = {
  billId: "bill",
  editorVersion: 4,
  draftId: "draft",
  draftRevision: 7,
};
const answer: DeadEndAnswer = {
  sends: true,
  deadEnds: [
    { key: "0", name: "Beer", quantity: "2", stationId: "bar", stationName: "Bar", why: "closed" },
  ],
  stations: [{ id: "kitchen", name: "Kitchen", open: true }],
};
async function saved() {
  const { el } = await mount();
  const draft = store(el);
  draft.addProduct(beer, "2");
  draft.addProduct(flan, "1");
  const checks: Check[] = [];
  el.addEventListener("check-dead-ends", (event) => {
    event.preventDefault();
    checks.push((event as CustomEvent<Check>).detail);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  el.orderId = "bill";
  el.billEdit = { ...expected };
  el.routingRevision = 7;
  await el.updateComplete;
  return { el, draft, checks };
}
const warning = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector("[data-draft-routing-warning]");
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});

it("checks the saved revision after 400 ms without opening a preview or sending dishes", async () => {
  const { el, draft, checks } = await saved();
  const submitted = vi.fn();
  el.addEventListener("submit-draft", submitted);
  await vi.advanceTimersByTimeAsync(399);
  expect(checks).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(checks).toHaveLength(1);
  expect(checks[0]!.automatic).toBe(true);
  expect(checks[0]!.sent).toEqual([...draft.lines]);
  expect(el.shadowRoot!.querySelector("[data-draft-preview]")).toBeNull();
  expect(submitted).not.toHaveBeenCalled();
  el.answerDeadEnds(checks[0]!.sent, answer, checks[0]!.checkId);
  await el.updateComplete;
  expect(warning(el)).not.toBeNull();
  expect(warning(el)!.textContent).toContain("⚠");
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1"]);
});

it("debounces successive saved revisions and does not repeat a completed check on unrelated renders", async () => {
  const { el, checks } = await saved();
  await vi.advanceTimersByTimeAsync(300);
  el.billEdit = { ...expected, draftRevision: 8 };
  el.routingRevision = 8;
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(399);
  expect(checks).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(checks).toHaveLength(1);
  el.answerDeadEnds(checks[0]!.sent, answer, checks[0]!.checkId);
  await el.updateComplete;
  el.requestUpdate();
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(500);
  expect(checks).toHaveLength(1);
});

it("waits for a saved revision instead of checking an unsaved local edit", async () => {
  const { el, draft, checks } = await saved();
  el.routingRevision = null;
  draft.setLineQuantity(0, "3");
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(500);
  expect(checks).toHaveLength(0);
  el.billEdit = { ...expected, draftRevision: 8 };
  el.routingRevision = 8;
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(400);
  expect(checks).toHaveLength(1);
  expect(checks[0]!.sent.map((line) => line.quantity)).toEqual(["3", "1"]);
});

it.each(["edit", "bill", "locked", "disconnect", "revision", "editor", "api"])(
  "ignores an old routing reply after %s, including clearing its saved station",
  async (change) => {
    const { el, draft, checks } = await saved();
    draft.lines[0]!.makeAt = "old-station";
    await vi.advanceTimersByTimeAsync(400);
    expect(checks).toHaveLength(1);
    const checked = checks[0]!;
    if (change === "edit") draft.setLineQuantity(0, "3");
    else if (change === "bill") {
      const other = new DraftStore();
      other.addProduct(beer, "1");
      el.draftStore = other;
      el.orderId = "other";
    } else if (change === "locked") draft.lockEdits();
    else if (change === "revision") {
      el.billEdit = { ...expected, draftRevision: 8 };
      el.routingRevision = 8;
    } else if (change === "editor") el.billEdit = { ...expected, editorVersion: 5 };
    else if (change === "api") el.api = {} as TillApi;
    else el.remove();
    el.answerDeadEnds(checked.sent, answer, checked.checkId);
    await el.updateComplete;
    expect(draft.lines[0]!.makeAt).toBe("old-station");
    expect(warning(el)).toBeNull();
  },
);

it.each(["sending", "locked", "group-command", "unsaved", "different-bill"])(
  "does not start a saved-revision check while %s",
  async (state) => {
    const { el, draft, checks } = await saved();
    if (state === "sending") draft.sending = true;
    else if (state === "locked") draft.lockEdits();
    else if (state === "group-command") el.groupCommandBusy = true;
    else if (state === "unsaved") el.routingRevision = null;
    else el.orderId = "another-bill";
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(500);
    expect(checks).toHaveLength(0);
  },
);

it("a newer routing check keeps its warning when the older answer arrives last", async () => {
  const { el, checks } = await saved();
  await vi.advanceTimersByTimeAsync(400);
  el.billEdit = { ...expected, draftRevision: 8 };
  el.routingRevision = 8;
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(400);
  expect(checks).toHaveLength(2);
  el.answerDeadEnds(checks[1]!.sent, answer, checks[1]!.checkId);
  await el.updateComplete;
  expect(warning(el)).not.toBeNull();
  el.answerDeadEnds(checks[0]!.sent, { ...answer, deadEnds: [] }, checks[0]!.checkId);
  await el.updateComplete;
  expect(warning(el)).not.toBeNull();
});

it("an unanswered new check retains the last warning until a current answer replaces it", async () => {
  const { el, checks } = await saved();
  await vi.advanceTimersByTimeAsync(400);
  expect(checks).toHaveLength(1);
  el.answerDeadEnds(checks[0]!.sent, answer, checks[0]!.checkId);
  await el.updateComplete;
  expect(warning(el)).not.toBeNull();
  el.billEdit = { ...expected, draftRevision: 8 };
  el.routingRevision = 8;
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(400);
  expect(checks).toHaveLength(2);
  el.answerDeadEnds(checks[1]!.sent, undefined, checks[1]!.checkId);
  await el.updateComplete;
  expect(warning(el)).not.toBeNull();
  el.answerDeadEnds(checks[1]!.sent, { ...answer, deadEnds: [] }, checks[1]!.checkId);
  await el.updateComplete;
  expect(warning(el)).toBeNull();
});
