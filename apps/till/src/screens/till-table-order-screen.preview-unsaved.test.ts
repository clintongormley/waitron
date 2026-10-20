import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { WtTextarea } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { PartyBill, TableParty } from "../api/client.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import {
  beer,
  menuOf,
  openDraftLine as openRawDraftLine,
  resized,
  tap,
} from "./till-table-order-screen.test-helpers.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";

const offeredBeer = {
  ...beer,
  unit: {
    id: "00000000-0000-0000-0000-000000000001",
    name: { en: "Each", es: "Unidad" },
    abbreviation: { en: "ea", es: "ud" },
    precision: 0,
    hardwareUnit: null,
  },
};
const party: TableParty = {
  kitchenNote: { scope: { partyId: "party" }, note: null, revision: 0, ownerRevision: 0 },
  id: "party",
  revision: 0,
  guestCount: 2,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-main",
  outstanding: "0.00",
  billCount: 2,
  tableIds: [],
  unsentDrafts: [],
  reminder: null,
};
const bills: PartyBill[] = ["wo-main", "wo-other"].map((workingOrderId) => ({
  workingOrderId,
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "party",
  label: null,
  status: "open",
  total: "0.00",
  outstanding: "0.00",
  hasPayments: false,
  receiptAvailable: false,
}));
class LineLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly store = new DraftStore();
  readonly submissions: SubmitDraftDetail[] = [];
  readonly protectionAtSubmit: boolean[] = [];
  override render() {
    return html`<till-table-order-screen
        .orderId=${"wo-main"}
        .party=${party}
        .bills=${bills}
        .products=${[offeredBeer]}
        .menus=${menuOf([offeredBeer])}
        .draftStore=${this.store}
        @submit-draft=${(event: CustomEvent<SubmitDraftDetail>) => {
          this.protectionAtSubmit.push(unload());
          this.submissions.push(event.detail);
        }}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("line-leave-test-app", LineLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function openDraftLine(...args: Parameters<typeof openRawDraftLine>) {
  const picker = await openRawDraftLine(...args);
  const addNote = picker.shadowRoot!.querySelector<HTMLElement>(".add-note");
  if (addNote) {
    await userEvent.click(addNote);
    await picker.updateComplete;
  }
  return picker;
}
async function mount() {
  const { el: app, host } = await mountWidget<LineLeaveApp>("line-leave-test-app", {});
  host.style.width = "1280px";
  const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await resized(screen);
  await tap(screen, "Beer");
  const picker = await openDraftLine(screen, 0);
  const dialog = picker.shadowRoot!.querySelector("wt-modal")!;
  await dialog.updateComplete;
  return { app, screen, picker, dialog };
}
async function note(picker: TillModifierPicker, value: string) {
  const field = picker.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("textarea")!, value);
  await picker.updateComplete;
}
const chosen = (picker: TillModifierPicker) =>
  picker.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.value;
async function close(picker: TillModifierPicker) {
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
}
async function question(app: LineLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function routing(
  screen: TillTableOrderScreen,
  revision: number,
  stations = [{ id: "kitchen", name: "Kitchen", open: true }],
) {
  const checked = new Promise<{
    sent: readonly import("../state/working-order.js").OrderLine[];
    checkId: number;
  }>((resolve) =>
    screen.addEventListener(
      "check-dead-ends",
      (event) => {
        event.preventDefault();
        resolve((event as CustomEvent).detail);
      },
      { once: true },
    ),
  );
  screen.billEdit = {
    billId: "wo-main",
    editorVersion: 1,
    draftId: "draft",
    draftRevision: revision,
  };
  screen.routingRevision = revision;
  const check = await checked;
  screen.answerDeadEnds(
    check.sent,
    {
      sends: true,
      stations,
      deadEnds: [
        {
          key: "0",
          name: "Beer",
          quantity: "1",
          stationId: "retired",
          stationName: "Retired station",
          why: "switched_off",
        },
      ],
    },
    check.checkId,
  );
  await screen.updateComplete;
}
const controls = (screen: TillTableOrderScreen) =>
  screen.shadowRoot!.querySelector("[data-draft-routing-detail] till-dead-ends-section")!;

for (const route of ["Close", "Escape"]) {
  it(`${route} retains the staged note until Discard and leaves the party draft intact`, async () => {
    const { app, screen, picker, dialog } = await mount();
    await note(picker, "No ice");
    if (route === "Close") await close(picker);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(chosen(picker)).toBe("No ice");
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    await expect.poll(() => q.open).toBe(false);
    expect(chosen(picker)).toBe("No ice");
    expect(unload()).toBe(true);
    await close(picker);
    await question(app);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
    await expect.poll(() => picker.isConnected).toBe(false);
    expect(app.submissions).toEqual([]);
    expect(app.store.lines.map((line) => [line.product.id, line.quantity])).toEqual([
      ["beer", "1"],
    ]);
    expect(app.store.lines[0]!.note).toBeUndefined();
    expect(unload()).toBe(false);
    const reopened = await openDraftLine(screen, 0);
    expect(chosen(reopened)).toBe("");
  });
}
it("an untouched line window closes without warning, retaining its draft", async () => {
  const { app, picker } = await mount();
  expect(unload()).toBe(false);
  await close(picker);
  await expect.poll(() => picker.isConnected).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.store.lineCount).toBe(1);
  expect(app.submissions).toEqual([]);
});
it("Save releases protection before direct Send and preserves the exact current-bill submission", async () => {
  const { app, screen, picker } = await mount();
  await note(picker, "No ice");
  expect(unload()).toBe(true);
  const protectionAtSave: boolean[] = [];
  picker.addEventListener("wt-modifier-confirm", () => protectionAtSave.push(unload()));
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  expect(protectionAtSave).toEqual([false]);
  await screen.updateComplete;
  expect(unload()).toBe(false);
  expect(app.submissions).toEqual([]);
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  expect(app.protectionAtSubmit).toEqual([false]);
  expect(app.submissions).toHaveLength(1);
  expect(app.submissions[0]!.billId).toBeUndefined();
  expect(screen.orderId).toBe("wo-main");
  expect(app.submissions[0]!.lines).toEqual([
    { menuItemId: "offer-beer", quantity: "1", note: "No ice" },
  ]);
  expect(app.submissions[0]!.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
  expect(picker.isConnected).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("a disconnected line window aborts the question and retains its opening baseline on reconnect", async () => {
  const { app, screen, picker } = await mount();
  await note(picker, "No ice");
  await close(picker);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  discard.click();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await picker.updateComplete;
  expect(chosen(picker)).toBe("No ice");
  expect(unload()).toBe(true);
  await close(picker);
  expect((await question(app)).open).toBe(true);
  expect(app.submissions).toEqual([]);
});
it("a child close report cannot dismiss an edited line window", async () => {
  const { picker, dialog } = await mount();
  await note(picker, "No ice");
  picker
    .shadowRoot!.querySelector("wt-textarea")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await picker.updateComplete;
  expect(dialog.open).toBe(true);
  expect(chosen(picker)).toBe("No ice");
});
it("retained station and removal changes stay in the party draft after Close without a second warning", async () => {
  const { app, screen, picker } = await mount();
  await routing(screen, 1);
  controls(screen).dispatchEvent(
    new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
  );
  await screen.updateComplete;
  expect(app.store.lines[0]!.makeAt).toBe("kitchen");
  expect(unload()).toBe(false);
  await close(picker);
  await expect.poll(() => picker.isConnected).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.store.lines[0]!.makeAt).toBe("kitchen");
  await openDraftLine(screen, 0);
  await routing(screen, 2, []);
  controls(screen).dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await screen.updateComplete;
  expect(app.store.lineCount).toBe(0);
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.submissions).toEqual([]);
});
it("removing another retained draft line does not silently clear a staged note's protection", async () => {
  const { app, screen, picker } = await mount();
  app.store.addProduct({ ...offeredBeer, id: "other", menuItemId: "offer-other" }, "2");
  await screen.updateComplete;
  await note(picker, "No ice");
  app.store.removeLine(1);
  await screen.updateComplete;
  expect(app.store.lines.map((line) => line.quantity)).toEqual(["1"]);
  expect(chosen(picker)).toBe("No ice");
  expect(unload()).toBe(true);
  await close(picker);
  expect((await question(app)).open).toBe(true);
  expect(app.submissions).toEqual([]);
});
it("Save aborts an old question and detached choice events cannot change the next line window", async () => {
  const { app, screen, picker } = await mount();
  await note(picker, "No ice");
  const oldField = picker.shadowRoot!.querySelector("wt-textarea")!;
  await close(picker);
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
  await expect.poll(() => q.open).toBe(false);
  const reopened = await openDraftLine(screen, 0);
  oldDiscard.click();
  oldField.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "stale" } }));
  await reopened.updateComplete;
  expect(reopened.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(chosen(reopened)).toBe("No ice");
  expect(unload()).toBe(false);
  expect(app.submissions).toHaveLength(0);
  expect(app.store.lines[0]!.note).toBe("No ice");
});
it("an asynchronous clean Close cannot close a replacement line window", async () => {
  const { screen, picker } = await mount();
  picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await expect.poll(() => picker.isConnected).toBe(false);
  const reopened = await openDraftLine(screen, 0);
  picker.dispatchEvent(
    new CustomEvent("wt-modifier-cancel", { detail: {}, bubbles: true, composed: true }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(reopened.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(chosen(reopened)).toBe("");
});
it("an enclosing leave asks about this child and resets only its staged note", async () => {
  const { app, screen, picker } = await mount();
  await note(picker, "No ice");
  let leaves = 0;
  const kept = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed: () => {
      leaves++;
    },
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  expect(await kept).toBe("kept");
  expect(leaves).toBe(0);
  expect(unload()).toBe(true);
  const discarded = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed: () => {
      leaves++;
    },
  });
  await question(app);
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  expect(await discarded).toBe("proceeded");
  await picker.updateComplete;
  expect(leaves).toBe(1);
  expect(chosen(picker)).toBe("");
  expect(app.store.lines[0]!.note).toBeUndefined();
  expect(app.submissions).toEqual([]);
  expect(unload()).toBe(false);
});
