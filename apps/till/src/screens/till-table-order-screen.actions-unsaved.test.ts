import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { PartyBill, TableParty, TabLine, TableState } from "../api/client.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

const party: TableParty = {
  kitchenNote: { scope: { partyId: "party" }, note: null, revision: 0, ownerRevision: 0 },
  id: "party",
  revision: 0,
  guestCount: 2,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  openingBillId: "main",
  outstanding: "12.00",
  billCount: 2,
  tableIds: ["t1", "t2"],
  unsentDrafts: [],
  reminder: null,
};
const bills: PartyBill[] = ["main", "other"].map((workingOrderId, index) => ({
  workingOrderId,
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "party",
  label: null,
  billNumber: index + 1,
  billName: null,
  status: "open",
  total: "6.00",
  outstanding: "6.00",
  hasPayments: false,
  receiptAvailable: false,
}));
const lines: TabLine[] = [1, 2].map((lineNo) => ({
  changesAfterSending: null,
  id: `line-${lineNo}`,
  name: lineNo === 1 ? "Staff Beer" : "Staff Wine",
  lineNo,
  productId: "beer",
  quantity: "4.000",
  unitPrecision: 0,
  unitPriceGross: "3.00",
  stationId: null,
  movable: false,
  groupId: null,
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
}));
const tables: TableState[] = ["t1", "t2"].map((id) => ({
  id,
  label: id,
  shortName: id,
  party,
  signals: [],
  zoneId: null,
  state: "open-tab",
  hasOpenTab: true,
  condition: "held",
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: null,
}));
class ActionsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  lineRows = lines;
  readonly commands: { type: string; detail: unknown }[] = [];
  readonly protectionAtSubmit: boolean[] = [];
  override render() {
    return html`<till-table-order-screen
        .orderId=${"main"}
        .party=${party}
        .bills=${bills}
        .lines=${this.lineRows}
        .tables=${tables}
        @split-table=${this.accept}
        @merge-bills=${this.accept}
        @move-dishes=${this.accept}
        @switch-bill=${this.accept}
        @new-bill=${this.accept}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
  private accept(event: CustomEvent) {
    this.protectionAtSubmit.push(unload());
    this.commands.push({ type: event.type, detail: event.detail });
  }
}
customElements.define("actions-leave-test-app", ActionsLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function click(screen: TillTableOrderScreen, selector: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await screen.updateComplete;
}
async function mount(verb: "split-table" | "merge" | "move-dishes" = "move-dishes") {
  const { el: app } = await mountWidget<ActionsLeaveApp>("actions-leave-test-app", {});
  const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await screen.updateComplete;
  screen
    .shadowRoot!.querySelector("[data-move-split]")!
    .shadowRoot!.querySelector<HTMLElement>("button")!
    .click();
  await click(screen, `[data-action="${verb}"]`);
  return { app, screen };
}
async function question(app: ActionsLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function answer(app: ActionsLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
const picked = (screen: TillTableOrderScreen, lineNo = 1) =>
  String(movePicks(screen).has(`line-${lineNo}`));
const moveCommand = (...lineNos: number[]) => ({
  type: "move-dishes",
  detail: { lineIds: lineNos.map((lineNo) => `line-${lineNo}`), toBillId: "other" },
});
async function moveToOther(screen: TillTableOrderScreen) {
  await click(screen, '[data-move-dishes-to="other"]');
  await click(screen, "[data-move-dishes-confirm]");
}

it("Back retains Move dishes' picks until Discard without dispatching a move", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
  await answer(app, "keep");
  expect(picked(screen)).toBe("true");
  await click(screen, "[data-action-back]");
  await answer(app, "discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-action-panel]") === null)
    .toBe(true);
  expect(app.commands).toEqual([]);
  expect(screen.lines).toEqual(lines);
  expect(unload()).toBe(false);
  await click(screen, '[data-action="move-dishes"]');
  expect(picked(screen)).toBe("false");
});
it("reverting a pick clears protection; clean Back asks nothing", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  expect(unload()).toBe(true);
  await pickDish(screen);
  expect(unload()).toBe(false);
  await click(screen, "[data-action-back]");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-action-panel]") === null)
    .toBe(true);
  expect((await question(app)).open).toBe(false);
});
it("Back protects a destination even before choosing a dish", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  await click(screen, '[data-move-dishes-to="other"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(pressedTo(screen)).toEqual(["other"]);
  await pickDish(screen);
  await click(screen, "[data-action-back]");
  await answer(app, "discard");
  await expect.poll(() => moveOpen(screen)).toBe(false);
  expect(unload()).toBe(false);
  expect(app.commands).toEqual([]);
  await click(screen, '[data-action="move-dishes"]');
  expect(pressedTo(screen)).toEqual([]);
  expect(picked(screen)).toBe("false");
});
it("picks are unordered and Move sends whole lines directly", async () => {
  const { app, screen } = await mount();
  await pickDish(screen, "line-2");
  await pickDish(screen, "line-1");
  expect(unload()).toBe(true);
  await moveToOther(screen);
  expect(app.commands).toEqual([moveCommand(1, 2)]);
  expect(app.protectionAtSubmit).toEqual([false]);
  expect((await question(app)).open).toBe(false);
});
it("Back protects the staged table choice, and the bill choice opens the guests window whose confirm submits", async () => {
  const { app, screen } = await mount("split-table");
  expect(unload()).toBe(false);
  await click(screen, '[data-target="t2"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  await click(screen, '[data-target="other"]');
  const guests = screen.shadowRoot!.querySelector("till-split-guests-dialog")!;
  await guests.updateComplete;
  guests.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-confirm]")!.click();
  await screen.updateComplete;
  expect(app.commands).toEqual([
    {
      type: "split-table",
      detail: {
        tableId: "t2",
        billId: "other",
        guestCounts: { staying: 2, leaving: null },
        prompt: expect.any(Object),
      },
    },
  ]);
  expect(app.protectionAtSubmit).toEqual([false]);
});
it("an ancestor leave resets staged selections only after Discard", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  const leave = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  expect((await question(app)).open).toBe(true);
  await answer(app, "discard");
  expect(await leave).toBe("proceeded");
  await screen.updateComplete;
  expect(moveOpen(screen)).toBe(true);
  expect(picked(screen)).toBe("false");
  expect(app.commands).toEqual([]);
  expect(unload()).toBe(false);
});
it("disconnect invalidates a question and reconnect protects retained selections", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(unload()).toBe(true);
  oldDiscard.click();
  await screen.updateComplete;
  expect(picked(screen)).toBe("true");
});
it("Move aborts an old leave answer before a new action flow opens", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, '[data-move-dishes-to="other"]');
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await click(screen, "[data-move-dishes-confirm]");
  await expect.poll(() => q.open).toBe(false);
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="move-dishes"]');
  await pickDish(screen, "line-2");
  oldDiscard.click();
  await screen.updateComplete;
  expect(picked(screen, 2)).toBe("true");
  expect(app.commands).toHaveLength(1);
});
it("same-identity live reads do not replace staged picks", async () => {
  const { screen } = await mount();
  await pickDish(screen);
  screen.lines = lines.map((line) => ({ ...line, unitPriceGross: "4.00" }));
  await screen.updateComplete;
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
  expect(unload()).toBe(true);
});
it("immediate merge targets retain their existing exemption", async () => {
  const { app, screen } = await mount("merge");
  await click(screen, '[data-target="other"]');
  expect(app.commands).toEqual([{ type: "merge-bills", detail: { fromBillId: "other" } }]);
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("departed Move dishes controls cannot change or submit a replacement flow", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  const picker = screen.shadowRoot!.querySelector("till-portion-picker")!;
  const oldTick = picker.shadowRoot!.querySelector<HTMLElement>('[data-pick="line-1"]')!;
  const oldTarget = screen.shadowRoot!.querySelector<HTMLElement>('[data-move-dishes-to="other"]')!;
  const oldConfirm = screen.shadowRoot!.querySelector<HTMLElement>("[data-move-dishes-confirm]")!;
  const oldBack = screen.shadowRoot!.querySelector<HTMLElement>("[data-action-back]")!;
  await moveToOther(screen);
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="move-dishes"]');
  await pickDish(screen, "line-2");
  oldTick.click();
  oldTarget.click();
  await screen.updateComplete;
  expect(picked(screen, 1)).toBe("false");
  expect(picked(screen, 2)).toBe("true");
  expect(pressedTo(screen)).toEqual([]);
  oldBack.click();
  oldConfirm.click();
  await screen.updateComplete;
  expect((await question(app)).open).toBe(false);
  expect(app.commands).toHaveLength(1);
  expect(picked(screen, 2)).toBe("true");
});
it("a departed destination and tick cannot alter a replacement flow", async () => {
  const { app, screen } = await mount();
  const oldTarget = screen.shadowRoot!.querySelector<HTMLElement>('[data-move-dishes-to="other"]')!;
  await click(screen, '[data-move-dishes-to="other"]');
  const picker = screen.shadowRoot!.querySelector("till-portion-picker")!;
  const oldTick = picker.shadowRoot!.querySelector<HTMLElement>('[data-pick="line-1"]')!;
  await pickDish(screen, "line-2");
  await click(screen, "[data-move-dishes-confirm]");
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="move-dishes"]');
  oldTarget.click();
  oldTick.click();
  await screen.updateComplete;
  expect(moveOpen(screen)).toBe(true);
  expect(unload()).toBe(false);
  expect(app.commands).toHaveLength(1);
});
it("a pick's notification cancels unload before the next render", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await pickDish(screen);
  expect(unload()).toBe(false);
  screen
    .shadowRoot!.querySelector("till-portion-picker")!
    .shadowRoot!.querySelector<HTMLElement>('[data-pick="line-2"]')!
    .click();
  expect(unload()).toBe(true);
  expect(app.commands).toEqual([]);
});
it("busy inputs refuse Back and submission without losing staged values", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, '[data-move-dishes-to="other"]');
  screen.busy = true;
  await screen.updateComplete;
  await pickDish(screen, "line-2");
  await click(screen, "[data-action-back]");
  await click(screen, "[data-move-dishes-confirm]");
  expect(picked(screen, 1)).toBe("true");
  expect(picked(screen, 2)).toBe("false");
  expect(app.commands).toEqual([]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(true);
});
it("bill replacement invalidates the old question without touching the new flow", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.orderId = "other";
  await screen.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="move-dishes"]');
  await pickDish(screen, "line-2");
  oldDiscard.click();
  await screen.updateComplete;
  expect(picked(screen, 2)).toBe("true");
  expect(app.commands).toEqual([]);
});
it("a busy transition invalidates an earlier Discard answer while retaining its input", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.busy = true;
  await screen.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  await screen.updateComplete;
  expect(picked(screen)).toBe("true");
  expect(unload()).toBe(true);
  expect(app.commands).toEqual([]);
});
it("departed action-menu controls cannot replace staged picks", async () => {
  const { app, screen } = await mount();
  await click(screen, "[data-action-back]");
  const oldName = screen.shadowRoot!.querySelector<HTMLElement>('[data-action="name"]')!;
  const oldMerge = screen.shadowRoot!.querySelector<HTMLElement>('[data-action="merge"]')!;
  const oldMove = screen.shadowRoot!.querySelector<HTMLElement>('[data-action="move-dishes"]')!;
  await click(screen, '[data-action="move-dishes"]');
  await pickDish(screen);
  oldName.click();
  oldMerge.click();
  oldMove.click();
  await screen.updateComplete;
  expect(picked(screen)).toBe("true");
  expect(screen.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
  expect(unload()).toBe(true);
  expect(app.commands).toEqual([]);
});
it("A803 single menu: another ⋮ item asks before leaving staged picks", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  expect(unload()).toBe(true);
  await click(screen, '[data-table-menu] [data-action="merge"]');
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(moveOpen(screen)).toBe(true);
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
  await click(screen, '[data-table-menu] [data-action="merge"]');
  await answer(app, "discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-target-picker]") !== null)
    .toBe(true);
  expect(moveOpen(screen)).toBe(false);
  expect(unload()).toBe(false);
  expect(app.commands).toEqual([]);
});
it("A803 single menu: a ⋮ item's old Discard answer does not replace a step opened since", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, '[data-move-dishes-to="other"]');
  await click(screen, '[data-table-menu] [data-action="merge"]');
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await click(screen, "[data-move-dishes-confirm]");
  await expect.poll(() => q.open).toBe(false);
  await click(screen, '[data-table-menu] [data-action="move-dishes"]');
  await pickDish(screen, "line-2");
  oldDiscard.click();
  await screen.updateComplete;
  expect(picked(screen, 2)).toBe("true");
  expect(screen.shadowRoot!.querySelector("[data-target-picker]")).toBeNull();
  expect(app.commands).toHaveLength(1);
});

it.each([
  ["another bill", '[data-switch-bill="other"]', "switch-bill", { workingOrderId: "other" }],
  ["+ New bill", "[data-new-bill]", "new-bill", {}],
])(
  "A803 switcher: choosing %s asks before leaving staged picks",
  async (_, selector, type, detail) => {
    const { app, screen } = await mount();
    await pickDish(screen);
    expect(unload()).toBe(true);
    await click(screen, `[data-bill-switcher] ${selector}`);
    expect((await question(app)).open).toBe(true);
    expect(app.commands).toEqual([]);
    await answer(app, "keep");
    expect(app.commands).toEqual([]);
    expect(moveOpen(screen)).toBe(true);
    expect(movePicks(screen)).toEqual(new Set(["line-1"]));
    expect(unload()).toBe(true);
    await click(screen, `[data-bill-switcher] ${selector}`);
    await answer(app, "discard");
    await expect.poll(() => app.commands).toEqual([{ type, detail }]);
    expect(app.protectionAtSubmit).toEqual([false]);
    expect(screen.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
    expect(unload()).toBe(false);
  },
);
it.each([
  ['[data-switch-bill="other"]', "switch-bill", { workingOrderId: "other" }],
  ["[data-new-bill]", "new-bill", {}],
])(
  "A803 switcher: %s with Move dishes… open and nothing chosen sends at once, asking nothing",
  async (selector, type, detail) => {
    const { app, screen } = await mount();
    await click(screen, `[data-bill-switcher] ${selector}`);
    await expect.poll(() => app.commands).toEqual([{ type, detail }]);
    expect(screen.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
    expect((await question(app)).open).toBe(false);
  },
);
it("A803 switcher: an old Discard answer from the switcher does not replace a step opened since", async () => {
  const { app, screen } = await mount();
  await pickDish(screen);
  await click(screen, '[data-move-dishes-to="other"]');
  await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await click(screen, "[data-move-dishes-confirm]");
  await expect.poll(() => q.open).toBe(false);
  await click(screen, '[data-table-menu] [data-action="move-dishes"]');
  await pickDish(screen, "line-2");
  oldDiscard.click();
  await screen.updateComplete;
  expect(picked(screen, 2)).toBe("true");
  expect(app.commands.map((command) => command.type)).toEqual(["move-dishes"]);
});

async function pickDish(screen: TillTableOrderScreen, id = "line-1") {
  const picker = screen.shadowRoot!.querySelector("till-portion-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLInputElement>(`[data-pick="${id}"]`)!.click();
  await screen.updateComplete;
  await picker.updateComplete;
}
const movePicks = (screen: TillTableOrderScreen) =>
  screen.shadowRoot!.querySelector("till-portion-picker")!.picks;
const pressedTo = (screen: TillTableOrderScreen) =>
  [...screen.shadowRoot!.querySelectorAll<HTMLElement>("[data-move-dishes-to]")]
    .filter((choice) => choice.getAttribute("aria-pressed") === "true")
    .map((choice) => choice.dataset.moveDishesTo);
const moveOpen = (screen: TillTableOrderScreen) =>
  screen.shadowRoot!.querySelector("[data-move-dishes]") !== null;
async function escape(screen: TillTableOrderScreen) {
  screen
    .shadowRoot!.querySelector("[data-move-dishes] h2")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  await screen.updateComplete;
}

it.each([
  ["Back", (screen: TillTableOrderScreen) => click(screen, "[data-action-back]")],
  ["Escape", escape],
])(
  "A803 move dishes unsaved: %s with a dish picked asks, keeps the picks on stay and sends nothing on Discard",
  async (_, leave) => {
    const { app, screen } = await mount("move-dishes");
    expect(unload()).toBe(false);
    await pickDish(screen);
    expect(unload()).toBe(true);
    await leave(screen);
    expect((await question(app)).open).toBe(true);
    await answer(app, "keep");
    expect(moveOpen(screen)).toBe(true);
    expect(movePicks(screen)).toEqual(new Set(["line-1"]));
    await leave(screen);
    await answer(app, "discard");
    await expect.poll(() => moveOpen(screen)).toBe(false);
    expect(app.commands).toEqual([]);
    expect(unload()).toBe(false);
  },
);
it("A803 move dishes unsaved: switching bill with a dish picked asks, and keeps the picks on stay", async () => {
  const { app, screen } = await mount("move-dishes");
  await pickDish(screen);
  await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(app.commands).toEqual([]);
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
  await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
  await answer(app, "discard");
  await expect
    .poll(() => app.commands)
    .toEqual([{ type: "switch-bill", detail: { workingOrderId: "other" } }]);
  expect(moveOpen(screen)).toBe(false);
});
it("A803 move dishes unsaved: leaving the table with a dish picked asks, and keeps the picks on stay", async () => {
  const { app, screen } = await mount("move-dishes");
  await pickDish(screen);
  const stay = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  await answer(app, "keep");
  expect(await stay).not.toBe("proceeded");
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
  const go = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  await answer(app, "discard");
  expect(await go).toBe("proceeded");
  expect(app.commands).toEqual([]);
  expect(unload()).toBe(false);
});
it("A803 move dishes unsaved: a destination alone is unsaved work, as Transfer's target is", async () => {
  const { app, screen } = await mount("move-dishes");
  await click(screen, '[data-move-dishes-to="new"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
});
it("A803 move dishes unsaved: a destination no longer offered is not unsaved work on its own", async () => {
  const { app, screen } = await mount("move-dishes");
  await click(screen, '[data-move-dishes-to="other"]');
  expect(unload()).toBe(true);
  screen.bills = bills.map((bill) =>
    bill.workingOrderId === "other" ? { ...bill, hasPayments: true } : bill,
  );
  await screen.updateComplete;
  expect(unload()).toBe(false);
  screen.bills = bills;
  await screen.updateComplete;
  expect(unload()).toBe(true);
  screen.bills = bills.filter((bill) => bill.workingOrderId !== "other");
  await screen.updateComplete;
  expect(unload()).toBe(false);
  await click(screen, "[data-action-back]");
  expect(moveOpen(screen)).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("A803 move dishes unsaved: with nothing picked, Back and switching bill ask nothing", async () => {
  const { app, screen } = await mount("move-dishes");
  expect(unload()).toBe(false);
  await click(screen, "[data-action-back]");
  expect(moveOpen(screen)).toBe(false);
  expect((await question(app)).open).toBe(false);
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="move-dishes"]');
  await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
  await expect
    .poll(() => app.commands)
    .toEqual([{ type: "switch-bill", detail: { workingOrderId: "other" } }]);
  expect((await question(app)).open).toBe(false);
});
it("A803 move dishes unsaved: a refresh is not a change, and keeps a pick it does not touch", async () => {
  const { screen } = await mount("move-dishes");
  screen.lines = lines.map((line) => ({ ...line }));
  await screen.updateComplete;
  expect(unload()).toBe(false);
  await pickDish(screen);
  screen.lines = lines.map((line) => ({ ...line }));
  await screen.updateComplete;
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
  expect(unload()).toBe(true);
});
it("A803 move dishes unsaved: a refresh that changes nothing leaves an open question open", async () => {
  const { app, screen } = await mount("move-dishes");
  await pickDish(screen);
  const leave = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  expect((await question(app)).open).toBe(true);
  screen.lines = lines.map((line) => ({ ...line }));
  await screen.updateComplete;
  await app.updateComplete;
  await answer(app, "keep");
  expect(await leave).toBe("kept");
  expect(movePicks(screen)).toEqual(new Set(["line-1"]));
});
it("A803 move dishes unsaved: a refresh that drops the only pick closes the question and the protection", async () => {
  const { app, screen } = await mount("move-dishes");
  await pickDish(screen);
  const leave = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  screen.lines = lines.filter((line) => line.id !== "line-1").map((line) => ({ ...line }));
  await screen.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  expect(await leave).toBe("stale");
  expect(movePicks(screen)).toEqual(new Set());
  expect(unload()).toBe(false);
});
it("A803 move dishes unsaved: an ancestor leave puts the picks and the destination back only after Discard", async () => {
  const { app, screen } = await mount("move-dishes");
  await pickDish(screen);
  await click(screen, '[data-move-dishes-to="other"]');
  const leave = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  await answer(app, "discard");
  expect(await leave).toBe("proceeded");
  await screen.updateComplete;
  expect(moveOpen(screen)).toBe(true);
  expect(movePicks(screen)).toEqual(new Set());
  expect(pressedTo(screen)).toEqual([]);
  expect(app.commands).toEqual([]);
  expect(unload()).toBe(false);
});
it("A803 move dishes unsaved: Move releases the protection before it sends", async () => {
  const { app, screen } = await mount("move-dishes");
  await pickDish(screen);
  await click(screen, '[data-move-dishes-to="other"]');
  screen
    .shadowRoot!.querySelector("[data-move-dishes-confirm]")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await screen.updateComplete;
  expect(app.commands).toEqual([
    { type: "move-dishes", detail: { lineIds: ["line-1"], toBillId: "other" } },
  ]);
  expect(app.protectionAtSubmit).toEqual([false]);
  expect((await question(app)).open).toBe(false);
});
