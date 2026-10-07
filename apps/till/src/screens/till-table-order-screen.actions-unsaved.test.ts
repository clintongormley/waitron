import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { PartyBill, TableParty, TabLine, TableState } from "../api/client.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

const party: TableParty = {
  id: "party",
  revision: 0,
  guestCount: 2,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "main",
  outstanding: "12.00",
  billCount: 2,
  tableIds: ["t1", "t2"],
  unsentDrafts: [],
  reminder: null,
};
const bills: PartyBill[] = ["main", "other"].map((workingOrderId) => ({
  workingOrderId,
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "party",
  label: null,
  status: "open",
  total: "6.00",
  outstanding: "6.00",
  hasPayments: false,
  receiptAvailable: false,
}));
const lines: TabLine[] = [1, 2].map((lineNo) => ({
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
  party,
  signals: [],
  zoneId: null,
  capacity: null,
  state: "open-tab",
  hasOpenTab: true,
  condition: "held",
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
        @split-lines=${this.accept}
        @transfer-lines=${this.accept}
        @split-table=${this.accept}
        @merge-bills=${this.accept}
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
async function mount(verb: "split" | "transfer" | "split-table" | "merge" = "split") {
  const { el: app } = await mountWidget<ActionsLeaveApp>("actions-leave-test-app", {});
  const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await screen.updateComplete;
  await click(screen, "[data-open-drawer]");
  await click(screen, "[data-move-split]");
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
const selected = (screen: TillTableOrderScreen, kind: "split" | "transfer", lineNo = 1) =>
  screen.shadowRoot!.querySelector(`[data-${kind}-line="${lineNo}"]`)!.getAttribute("aria-pressed");

it("Back retains split quantities until Discard without dispatching a split", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, '[data-split-dec="1"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  expect(screen.shadowRoot!.querySelector('[data-split-count="1"]')!.textContent).toBe("3");
  await answer(app, "keep");
  expect(selected(screen, "split")).toBe("true");
  await click(screen, "[data-action-back]");
  await answer(app, "discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-action-menu]") !== null)
    .toBe(true);
  expect(app.commands).toEqual([]);
  expect(screen.lines).toEqual(lines);
  expect(unload()).toBe(false);
  await click(screen, '[data-action="split"]');
  expect(selected(screen, "split")).toBe("false");
});
it("reverting split membership clears protection; clean Back asks nothing", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  expect(unload()).toBe(true);
  await click(screen, '[data-split-line="1"]');
  expect(unload()).toBe(false);
  await click(screen, "[data-action-back]");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-action-menu]") !== null)
    .toBe(true);
  expect((await question(app)).open).toBe(false);
});
it("Confirm releases split inputs before dispatching the exact partial quantity", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, '[data-split-dec="1"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-split-confirm]");
  expect(app.commands).toEqual([
    { type: "split-lines", detail: { transfers: [{ lineNo: 1, quantity: "3" }] } },
  ]);
  expect(app.protectionAtSubmit).toEqual([false]);
  expect((await question(app)).open).toBe(false);
});
it("Back protects a transfer target even before choosing a line", async () => {
  const { app, screen } = await mount("transfer");
  expect(unload()).toBe(false);
  await click(screen, '[data-target="other"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(screen.shadowRoot!.querySelector("[data-transfer-lines]")).not.toBeNull();
  await click(screen, '[data-transfer-line="1"]');
  await click(screen, "[data-action-back]");
  await answer(app, "discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-target-picker]") !== null)
    .toBe(true);
  expect(unload()).toBe(false);
  expect(app.commands).toEqual([]);
  await click(screen, '[data-target="other"]');
  expect(selected(screen, "transfer")).toBe("false");
});
it("transfer membership is unordered and Confirm accepts whole lines directly", async () => {
  const { app, screen } = await mount("transfer");
  await click(screen, '[data-target="other"]');
  await click(screen, '[data-transfer-line="2"]');
  await click(screen, '[data-transfer-line="1"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-transfer-confirm]");
  expect(app.commands).toEqual([
    {
      type: "transfer-lines",
      detail: { toBillId: "other", transfers: [{ lineNo: 1 }, { lineNo: 2 }] },
    },
  ]);
  expect(app.protectionAtSubmit).toEqual([false]);
  expect((await question(app)).open).toBe(false);
});
it("Back protects the staged table choice and explicit bill choice submits directly", async () => {
  const { app, screen } = await mount("split-table");
  expect(unload()).toBe(false);
  await click(screen, '[data-target="t2"]');
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  await click(screen, '[data-target="other"]');
  expect(app.commands).toEqual([
    { type: "split-table", detail: { tableId: "t2", billId: "other" } },
  ]);
  expect(app.protectionAtSubmit).toEqual([false]);
});
it("an ancestor leave resets staged selections only after Discard", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  const leave = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  expect((await question(app)).open).toBe(true);
  await answer(app, "discard");
  expect(await leave).toBe("proceeded");
  await screen.updateComplete;
  expect(selected(screen, "split")).toBe("false");
  expect(app.commands).toEqual([]);
  expect(unload()).toBe(false);
});
it("disconnect invalidates a question and reconnect protects retained selections", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
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
  expect(selected(screen, "split")).toBe("true");
});
it("Confirm aborts an old leave answer before a new action flow opens", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await click(screen, "[data-split-confirm]");
  await expect.poll(() => q.open).toBe(false);
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="split"]');
  await click(screen, '[data-split-line="2"]');
  oldDiscard.click();
  await screen.updateComplete;
  expect(selected(screen, "split", 2)).toBe("true");
  expect(app.commands).toHaveLength(1);
});
it("same-identity live reads do not replace a staged split", async () => {
  const { screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, '[data-split-dec="1"]');
  screen.lines = lines.map((line) => ({ ...line, unitPriceGross: "4.00" }));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector('[data-split-count="1"]')!.textContent).toBe("3");
  expect(unload()).toBe(true);
});
it("immediate merge targets retain their existing exemption", async () => {
  const { app, screen } = await mount("merge");
  await click(screen, '[data-target="other"]');
  expect(app.commands).toEqual([{ type: "merge-bills", detail: { fromBillId: "other" } }]);
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("departed split controls cannot change or submit a replacement flow", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  const oldToggle = screen.shadowRoot!.querySelector<HTMLElement>('[data-split-line="1"]')!;
  const oldCount = screen.shadowRoot!.querySelector<HTMLElement>('[data-split-dec="1"]')!;
  const oldConfirm = screen.shadowRoot!.querySelector<HTMLElement>("[data-split-confirm]")!;
  const oldBack = screen.shadowRoot!.querySelector<HTMLElement>("[data-action-back]")!;
  await click(screen, "[data-split-confirm]");
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="split"]');
  await click(screen, '[data-split-line="2"]');
  oldToggle.click();
  oldCount.click();
  await screen.updateComplete;
  expect(selected(screen, "split", 1)).toBe("false");
  expect(selected(screen, "split", 2)).toBe("true");
  oldBack.click();
  oldConfirm.click();
  await screen.updateComplete;
  expect((await question(app)).open).toBe(false);
  expect(app.commands).toHaveLength(1);
  expect(selected(screen, "split", 2)).toBe("true");
});
it("a departed transfer target and line cannot alter a replacement flow", async () => {
  const { app, screen } = await mount("transfer");
  const oldTarget = screen.shadowRoot!.querySelector<HTMLElement>('[data-target="other"]')!;
  await click(screen, '[data-target="other"]');
  const oldLine = screen.shadowRoot!.querySelector<HTMLElement>('[data-transfer-line="1"]')!;
  await click(screen, '[data-transfer-line="2"]');
  await click(screen, "[data-transfer-confirm]");
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="split"]');
  oldTarget.click();
  oldLine.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-split-lines]")).not.toBeNull();
  expect(unload()).toBe(false);
  expect(app.commands).toHaveLength(1);
});
it("raw invalid quantity remains protected after a refused local submission", async () => {
  const { app, screen } = await mount();
  app.lineRows = lines.map((line) => ({ ...line, unitPrecision: 3 }));
  screen.lines = app.lineRows;
  await screen.updateComplete;
  await click(screen, '[data-split-line="1"]');
  const field = screen.shadowRoot!.querySelector('[data-split-quantity="1"]')!;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "bad";
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  await screen.updateComplete;
  await click(screen, "[data-split-confirm]");
  expect(app.commands).toEqual([]);
  expect(unload()).toBe(true);
  await click(screen, "[data-action-back]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(input.value).toBe("bad");
});
it("quantity notification cancels unload before the next render", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, '[data-split-line="1"]');
  expect(unload()).toBe(false);
  screen.shadowRoot!.querySelector<HTMLElement>('[data-split-line="2"]')!.click();
  expect(unload()).toBe(true);
  expect(app.commands).toEqual([]);
});
it("busy inputs refuse Back and submission without losing staged values", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  screen.busy = true;
  await screen.updateComplete;
  await click(screen, '[data-split-line="2"]');
  await click(screen, "[data-action-back]");
  await click(screen, "[data-split-confirm]");
  expect(selected(screen, "split", 1)).toBe("true");
  expect(selected(screen, "split", 2)).toBe("false");
  expect(app.commands).toEqual([]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(true);
});
it("bill replacement invalidates the old question without touching the new flow", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.orderId = "other";
  await screen.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  await click(screen, "[data-move-split]");
  await click(screen, '[data-action="split"]');
  await click(screen, '[data-split-line="2"]');
  oldDiscard.click();
  await screen.updateComplete;
  expect(selected(screen, "split", 2)).toBe("true");
  expect(app.commands).toEqual([]);
});
it("a busy transition invalidates an earlier Discard answer while retaining its input", async () => {
  const { app, screen } = await mount();
  await click(screen, '[data-split-line="1"]');
  await click(screen, "[data-action-back]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.busy = true;
  await screen.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  await screen.updateComplete;
  expect(selected(screen, "split")).toBe("true");
  expect(unload()).toBe(true);
  expect(app.commands).toEqual([]);
});
it("departed action-menu controls cannot replace a staged split", async () => {
  const { app, screen } = await mount();
  await click(screen, "[data-action-back]");
  const oldName = screen.shadowRoot!.querySelector<HTMLElement>('[data-action="name"]')!;
  const oldTransfer = screen.shadowRoot!.querySelector<HTMLElement>('[data-action="transfer"]')!;
  const oldSplit = screen.shadowRoot!.querySelector<HTMLElement>('[data-action="split"]')!;
  await click(screen, '[data-action="split"]');
  await click(screen, '[data-split-line="1"]');
  oldName.click();
  oldTransfer.click();
  oldSplit.click();
  await screen.updateComplete;
  expect(selected(screen, "split")).toBe("true");
  expect(screen.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
  expect(unload()).toBe(true);
  expect(app.commands).toEqual([]);
});
