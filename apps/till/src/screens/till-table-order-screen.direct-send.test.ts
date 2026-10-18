import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DeadEndAnswer, OrderGroup } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, flan, mount, resized, store } from "./till-table-order-screen.test-helpers.js";

const main = { id: "main", name: "Mains", displayOrder: 2, heldUntilFired: true };
const held: OrderGroup = {
  id: "held",
  position: 3,
  displayNumber: 8,
  numberPartyId: "party",
  state: "held",
  courseIds: ["main"],
  firedAt: null,
  remindAt: null,
  lineIds: [],
  summary: "Mains",
};
const root = (el: TillTableOrderScreen) => el.shadowRoot!;
const action = (el: TillTableOrderScreen, kind: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-draft-action="${kind}"]`)!;
async function arranged() {
  const { el, host } = await mount({ courses: [main] });
  host.style.width = "1280px";
  await resized(el);
  const draft = store(el);
  draft.addProduct(beer, "2");
  draft.addProduct({ ...flan, courseId: "main" }, "1");
  draft.addProduct(
    { ...beer, id: "water", menuItemId: "offer-water", name: "Water", courseId: "main" },
    "3",
  );
  draft.setLinePlaces([0], { kind: "fire" });
  draft.setLinePlaces([1], { kind: "new", slot: 1, afterGroupId: "held" });
  draft.setLinePlaces([2], { kind: "join", groupId: "held" });
  el.groups = [held];
  const submissions: SubmitDraftDetail[] = [];
  el.addEventListener("submit-draft", (event) =>
    submissions.push((event as CustomEvent<SubmitDraftDetail>).detail),
  );
  await el.updateComplete;
  return { el, draft, submissions };
}
beforeEach(() => setLocale("en"));
afterEach(async () => {
  vi.useRealTimers();
  for (const dialog of document.querySelectorAll("till-table-order-screen"))
    await (dialog as TillTableOrderScreen).updateComplete;
  cleanupWidgets();
});

it("Send all immediately submits this bill's displayed arrangement, including a later addition", async () => {
  const { el, draft, submissions } = await arranged();
  await userEvent.click(action(el, "send-all"));
  await el.updateComplete;
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.sent).toEqual([...draft.lines]);
  expect(submissions[0]!.lines).toEqual([
    { menuItemId: "offer-beer", quantity: "2" },
    { menuItemId: "offer-flan", quantity: "1" },
    { menuItemId: "offer-water", quantity: "3" },
  ]);
  expect(submissions[0]!.groups).toEqual([
    { release: "fire", lineIndexes: [0] },
    { release: "hold", lineIndexes: [1], afterGroupId: "held" },
    { release: "hold", lineIndexes: [2], joinGroupId: "held" },
  ]);
  expect(submissions[0]!.billId).toBeUndefined();
  expect(submissions[0]!.joinGroupId).toBeUndefined();
  expect(
    root(el).querySelector<HTMLElement & { open: boolean }>("[data-draft-preview]")?.open ?? false,
  ).toBe(false);
  expect(root(el).querySelector("[data-destination-choice]")).toBeNull();
});

it("Fire sends only ticked dishes immediately and keeps the Send all action available", async () => {
  const { el, draft, submissions } = await arranged();
  expect(action(el, "fire-selected").disabled).toBe(true);
  expect(action(el, "fire-selected").variant).toBe("secondary");
  await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-select="1"]')!);
  await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-select="2"]')!);
  expect(action(el, "send-all").disabled).toBe(false);
  expect(action(el, "fire-selected").textContent!.trim()).toBe("Fire");
  await userEvent.click(action(el, "fire-selected"));
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.sent).toEqual([draft.lines[1], draft.lines[2]]);
  expect(submissions[0]!.groups).toEqual([{ release: "fire", lineIndexes: [0, 1] }]);
  expect(draft.lines.map((line) => [line.quantity, line.place])).toEqual([
    ["2", { kind: "fire" }],
    ["1", { kind: "new", slot: 1, afterGroupId: "held" }],
    ["3", { kind: "join", groupId: "held" }],
  ]);
});

it.each(["send-all", "fire-selected"])(
  "%s leaves unsellable and unresolved routing rows in the outbox",
  async (kind) => {
    const { el, draft, submissions } = await arranged();
    draft.lines[1]!.blocked = "period_ended";
    const checks: { sent: SubmitDraftDetail["sent"]; checkId: number }[] = [];
    el.addEventListener("check-dead-ends", (event) => {
      event.preventDefault();
      checks.push((event as CustomEvent).detail);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    el.orderId = "bill";
    el.billEdit = { billId: "bill", editorVersion: 1, draftId: "draft", draftRevision: 7 };
    el.routingRevision = 7;
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(400);
    expect(checks).toHaveLength(1);
    const answer: DeadEndAnswer = {
      sends: true,
      stations: [],
      deadEnds: [
        {
          key: "2",
          name: "Water",
          quantity: "3",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
    };
    el.answerDeadEnds(checks[0]!.sent, answer, checks[0]!.checkId);
    vi.useRealTimers();
    await el.updateComplete;
    await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-group-select="fire"]')!);
    await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-select="1"]')!);
    await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-select="2"]')!);
    await userEvent.click(action(el, kind));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.sent).toEqual([draft.lines[0]]);
    expect(submissions[0]!.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
    expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "3"]);
    expect(root(el).querySelector("[data-draft-routing-warning]")).not.toBeNull();
  },
);

it.each(["locked", "sending", "group-command", "permission", "other-store", "disconnected"])(
  "a retained action cannot submit after %s",
  async (change) => {
    const { el, draft, submissions } = await arranged();
    const old = action(el, "send-all");
    if (change === "locked") draft.lockEdits();
    else if (change === "sending") draft.sending = true;
    else if (change === "group-command") el.groupCommandBusy = true;
    else if (change === "permission") el.orderingAllowed = false;
    else if (change === "other-store") el.draftStore = new DraftStore();
    else el.remove();
    old.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(submissions).toEqual([]);
  },
);

it("keeps the same direct actions when an outbox starts after earlier food was sent", async () => {
  const { el, host } = await mount({ groups: [held], courses: [main] });
  host.style.width = "1280px";
  await resized(el);
  const draft = store(el);
  draft.addProduct({ ...flan, courseId: "main" }, "2");
  draft.setLinePlaces([0], { kind: "join", groupId: "held" });
  await el.updateComplete;
  const submissions: SubmitDraftDetail[] = [];
  el.addEventListener("submit-draft", (event) =>
    submissions.push((event as CustomEvent<SubmitDraftDetail>).detail),
  );
  expect(root(el).querySelectorAll("[data-draft-action]")).toHaveLength(2);
  expect(action(el, "fire-selected").disabled).toBe(true);
  expect(root(el).querySelector("[data-destination-choice]")).toBeNull();
  await userEvent.click(action(el, "send-all"));
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.draft.laterAddition).toBe(true);
  expect(submissions[0]!.groups).toEqual([
    { release: "hold", lineIndexes: [0], joinGroupId: "held" },
  ]);
});

it("Send all still sends every eligible row when only one row is ticked", async () => {
  const { el, draft, submissions } = await arranged();
  await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-select="1"]')!);
  await userEvent.click(action(el, "send-all"));
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.sent).toEqual([...draft.lines]);
  expect(submissions[0]!.groups).toHaveLength(3);
});

it("does not submit even a forged click when every row is blocked", async () => {
  const { el, draft, submissions } = await arranged();
  draft.setBlocked(["unavailable", "period_ended", "unavailable"]);
  await el.updateComplete;
  for (const kind of ["send-all", "fire-selected"]) {
    expect(action(el, kind).disabled).toBe(true);
    action(el, kind).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  }
  expect(submissions).toEqual([]);
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "3"]);
});

it.each(["send-all", "fire-selected"])(
  "%s maps the visible within-group order to its live line objects",
  async (kind) => {
    const { el, host } = await mount();
    host.style.width = "1280px";
    await resized(el);
    const draft = store(el);
    draft.addProduct(flan, "1");
    draft.addProduct(beer, "2");
    const submissions: SubmitDraftDetail[] = [];
    el.addEventListener("submit-draft", (event) =>
      submissions.push((event as CustomEvent<SubmitDraftDetail>).detail),
    );
    await el.updateComplete;
    expect(
      [...root(el).querySelectorAll("[data-draft-select]")].map((row) =>
        row.getAttribute("data-draft-select"),
      ),
    ).toEqual(["1", "0"]);
    await userEvent.click(root(el).querySelector<HTMLElement>('[data-draft-group-select="fire"]')!);
    await userEvent.click(action(el, kind));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.sent).toEqual([draft.lines[1], draft.lines[0]]);
    expect(submissions[0]!.lines).toEqual([
      { menuItemId: "offer-beer", quantity: "2" },
      { menuItemId: "offer-flan", quantity: "1" },
    ]);
  },
);
