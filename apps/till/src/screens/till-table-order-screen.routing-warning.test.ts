import { afterEach, beforeEach, expect, it } from "vitest";
import type { DeadEndAnswer } from "../api/client.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { OrderLine } from "../state/working-order.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  beer,
  flan,
  mount,
  openDraftLine,
  resized,
  store,
} from "./till-table-order-screen.test-helpers.js";

const answer: DeadEndAnswer = {
  sends: true,
  deadEnds: [
    { key: "0", name: "Beer", quantity: "2", stationId: "bar", stationName: "Bar", why: "closed" },
  ],
  stations: [{ id: "kitchen", name: "Kitchen", open: true }],
};
const root = (el: TillTableOrderScreen) => el.shadowRoot!;
const warning = (el: TillTableOrderScreen) =>
  root(el).querySelector<HTMLElement>("[data-draft-routing-warning]");
interface RoutingCheck {
  sent: readonly OrderLine[];
  checkId: number;
}
function checkSaved(el: TillTableOrderScreen): Promise<RoutingCheck> {
  const checked = new Promise<RoutingCheck>((resolve) =>
    el.addEventListener(
      "check-dead-ends",
      (event) => {
        event.preventDefault();
        resolve((event as CustomEvent<RoutingCheck>).detail);
      },
      { once: true },
    ),
  );
  const revision = (el.routingRevision ?? 0) + 1;
  el.billEdit = {
    billId: el.orderId!,
    editorVersion: 1,
    draftId: "draft",
    draftRevision: revision,
  };
  el.routingRevision = revision;
  return checked;
}
async function checked() {
  const { el, host } = await mount();
  host.style.width = "1280px";
  await resized(el);
  const draft = store(el);
  draft.addProduct(beer, "2");
  draft.addProduct(flan, "1");
  await el.updateComplete;
  const check = await checkSaved(el);
  el.answerDeadEnds(check.sent, answer, check.checkId);
  await el.updateComplete;
  await openDraftLine(el, 0);
  return { el, draft };
}
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it("shows a saved dish's routing refusal with a symbol, reason and replacement stations before Send, with choices in its line window", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  expect(warning(el)!.getAttribute("slot")).toBe("after-0");
  expect(warning(el)!.querySelector('[aria-hidden="true"]')).not.toBeNull();
  const detail = root(el).querySelector("[data-draft-routing-detail] till-dead-ends-section")!;
  await (detail as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(detail.shadowRoot!.textContent).toContain("Bar");
  expect(detail.shadowRoot!.textContent).toContain("closed");
  expect(detail.shadowRoot!.querySelector("wt-combobox")!.options).toEqual([
    { value: "kitchen", label: "Kitchen" },
  ]);
  expect(root(el).querySelectorAll("[data-draft-routing-warning]")).toHaveLength(1);
  expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([
    ["Beer", "2"],
    ["Flan", "1"],
  ]);
});

it("a replacement station updates only its live dish and clears the routing marker", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  root(el)
    .querySelector("[data-draft-routing-detail] till-dead-ends-section")!
    .dispatchEvent(
      new CustomEvent("make-at", {
        detail: { key: "0", stationId: "kitchen" },
        bubbles: true,
        composed: true,
      }),
    );
  await el.updateComplete;
  expect(draft.lines[0]!.makeAt).toBe("kitchen");
  expect(draft.lines[1]!.makeAt).toBeUndefined();
  expect(warning(el)).toBeNull();
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1"]);
});

it("a routing warning cannot follow the screen onto another bill", async () => {
  const { el } = await checked();
  expect(warning(el)).not.toBeNull();
  const old = root(el).querySelector("[data-draft-routing-detail] till-dead-ends-section")!;
  const replacement = new DraftStore();
  replacement.addProduct(beer, "1");
  el.draftStore = replacement;
  el.orderId = "other";
  await el.updateComplete;
  old.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  expect(warning(el)).toBeNull();
  expect(replacement.lines[0]!.makeAt).toBeUndefined();
});

it.each(["sending", "locked", "group-command"])(
  "retained routing controls refuse edits while %s",
  async (state) => {
    const { el, draft } = await checked();
    expect(warning(el)).not.toBeNull();
    const detail = root(el).querySelector("[data-draft-routing-detail] till-dead-ends-section")!;
    if (state === "sending") draft.sending = true;
    else if (state === "locked") draft.lockEdits();
    else el.groupCommandBusy = true;
    detail.dispatchEvent(
      new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
    );
    detail.dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
    await el.updateComplete;
    expect(draft.lines[0]!.makeAt).toBeUndefined();
    expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1"]);
  },
);

it("retained Remove removes only its dish and leaves another row's quantity intact", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  root(el)
    .querySelector("[data-draft-routing-detail] till-dead-ends-section")!
    .dispatchEvent(
      new CustomEvent("remove", { detail: { key: "0" }, bubbles: true, composed: true }),
    );
  await el.updateComplete;
  expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([["Flan", "1"]]);
  expect(warning(el)).toBeNull();
});

it("does not accept an unoffered station from a retained control", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  root(el)
    .querySelector("[data-draft-routing-detail] till-dead-ends-section")!
    .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "other" } }));
  expect(draft.lines[0]!.makeAt).toBeUndefined();
  expect(warning(el)).not.toBeNull();
});

it("a response for an old bill cannot clear its retained station or mark the new bill", async () => {
  const { el, draft } = await checked();
  draft.setLineMakeAt(0, "old-station");
  await el.updateComplete;
  const check = await checkSaved(el);
  const replacement = new DraftStore();
  replacement.addProduct(beer, "1");
  el.draftStore = replacement;
  el.orderId = "other";
  el.answerDeadEnds(check.sent, answer, check.checkId);
  await el.updateComplete;
  expect(draft.lines[0]!.makeAt).toBe("old-station");
  expect(replacement.lines[0]!.makeAt).toBeUndefined();
  expect(warning(el)).toBeNull();
});

it("a replaced routing answer invalidates an old row's station and Remove controls", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  const old = root(el).querySelector("[data-draft-routing-detail] till-dead-ends-section")!;
  const check = await checkSaved(el);
  el.answerDeadEnds(check.sent, { ...answer, deadEnds: [] }, check.checkId);
  old.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  old.dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await el.updateComplete;
  expect(warning(el)).toBeNull();
  expect(draft.lines[0]!.makeAt).toBeUndefined();
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1"]);
});

it("a removed dish's detached routing controls cannot edit its successor", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  const old = root(el).querySelector("[data-draft-routing-detail] till-dead-ends-section")!;
  draft.removeLine(0);
  old.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  old.dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await el.updateComplete;
  expect(draft.lines.map((line) => [line.product.name, line.quantity, line.makeAt])).toEqual([
    ["Flan", "1", undefined],
  ]);
  expect(warning(el)).toBeNull();
});

it("a disconnected row cannot change or remove the retained outbox", async () => {
  const { el, draft } = await checked();
  expect(warning(el)).not.toBeNull();
  const old = root(el).querySelector("[data-draft-routing-detail] till-dead-ends-section")!;
  el.remove();
  old.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  old.dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  expect(draft.lines.map((line) => [line.quantity, line.makeAt])).toEqual([
    ["2", undefined],
    ["1", undefined],
  ]);
});
