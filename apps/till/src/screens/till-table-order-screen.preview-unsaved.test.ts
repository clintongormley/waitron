import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { PartyBill, TableParty } from "../api/client.js";
import { beer, menuOf, tap } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

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
class PreviewLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly store = new DraftStore();
  readonly submissions: unknown[] = [];
  readonly protectionAtSubmit: boolean[] = [];
  override render() {
    return html`<till-table-order-screen
        .orderId=${"wo-main"}
        .party=${party}
        .bills=${bills}
        .products=${[offeredBeer]}
        .menus=${menuOf([beer])}
        .draftStore=${this.store}
        @submit-draft=${(event: CustomEvent) => {
          this.protectionAtSubmit.push(unload());
          this.submissions.push(event.detail);
        }}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("preview-leave-test-app", PreviewLeaveApp);
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
async function mount() {
  const { el: app } = await mountWidget<PreviewLeaveApp>("preview-leave-test-app", {});
  const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await screen.updateComplete;
  await tap(screen, "Beer");
  await click(screen, '[data-draft-action="fire-all"]');
  const dialog = screen.shadowRoot!.querySelector<WtDialog>("[data-draft-preview]")!;
  await dialog.updateComplete;
  return { app, screen, dialog };
}
async function choose(screen: TillTableOrderScreen) {
  screen
    .shadowRoot!.querySelector<HTMLInputElement>('input[name=billId][value="wo-other"]')!
    .click();
  await screen.updateComplete;
}
const chosen = (screen: TillTableOrderScreen) =>
  screen.shadowRoot!.querySelector<HTMLInputElement>("input[name=billId]:checked")!.value;
async function question(app: PreviewLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
for (const route of ["Back", "Escape"]) {
  it(`${route} retains the chosen bill until Discard and leaves the party draft intact`, async () => {
    const { app, screen, dialog } = await mount();
    await choose(screen);
    if (route === "Back") await click(screen, "[data-draft-dismiss]");
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(chosen(screen)).toBe("wo-other");
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(chosen(screen)).toBe("wo-other");
    expect(unload()).toBe(true);
    await click(screen, "[data-draft-dismiss]");
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => dialog.open).toBe(false);
    expect(app.submissions).toEqual([]);
    expect(app.store.lines.map((line) => [line.product.id, line.quantity])).toEqual([
      ["beer", "1"],
    ]);
    expect(unload()).toBe(false);
    await click(screen, '[data-draft-action="fire-all"]');
    expect(chosen(screen)).toBe("wo-main");
  });
}
it("an untouched preview closes without warning, retaining its draft", async () => {
  const { app, screen, dialog } = await mount();
  expect(unload()).toBe(false);
  await click(screen, "[data-draft-dismiss]");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.store.lineCount).toBe(1);
  expect(app.submissions).toEqual([]);
});
it("Confirm releases its choice before dispatch and preserves the existing exact submission", async () => {
  const { app, screen, dialog } = await mount();
  await choose(screen);
  expect(unload()).toBe(true);
  await click(screen, "[data-draft-confirm]");
  expect(app.protectionAtSubmit).toEqual([false]);
  expect(app.submissions).toHaveLength(1);
  const submission = app.submissions[0] as { billId: string; lines: unknown; groups: unknown };
  expect(submission.billId).toBe("wo-other");
  expect(submission.lines).toEqual([{ menuItemId: "offer-beer", quantity: "1" }]);
  expect(submission.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("a disconnected preview aborts the question and retains its opening baseline on reconnect", async () => {
  const { app, screen } = await mount();
  await choose(screen);
  await click(screen, "[data-draft-dismiss]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  discard.click();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(chosen(screen)).toBe("wo-other");
  expect(unload()).toBe(true);
  await click(screen, "[data-draft-dismiss]");
  expect((await question(app)).open).toBe(true);
  expect(app.submissions).toEqual([]);
});
it("a child close report cannot dismiss an edited preview", async () => {
  const { screen, dialog } = await mount();
  await choose(screen);
  dialog
    .querySelector("[data-send-to]")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await screen.updateComplete;
  expect(dialog.open).toBe(true);
  expect(chosen(screen)).toBe("wo-other");
});

it("retained station and removal changes stay in the party draft after Back without a second warning", async () => {
  const { app, screen, dialog } = await mount();
  screen.answerDeadEnds([...app.store.lines], {
    sends: true,
    stations: [{ id: "kitchen", name: "Kitchen", open: true }],
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
  });
  await screen.updateComplete;
  const section = screen.shadowRoot!.querySelector("till-dead-ends-section")!;
  section.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await screen.updateComplete;
  expect(app.store.lines[0]!.makeAt).toBe("kitchen");
  expect(unload()).toBe(false);
  await click(screen, "[data-draft-dismiss]");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.store.lines[0]!.makeAt).toBe("kitchen");
  await click(screen, '[data-draft-action="fire-all"]');
  screen.answerDeadEnds([...app.store.lines], {
    sends: true,
    stations: [],
    deadEnds: [
      {
        key: "0",
        name: "Beer",
        quantity: "1",
        stationId: "kitchen",
        stationName: "Kitchen",
        why: "switched_off",
      },
    ],
  });
  await screen.updateComplete;
  screen
    .shadowRoot!.querySelector("till-dead-ends-section")!
    .dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await screen.updateComplete;
  expect(app.store.lineCount).toBe(0);
  expect(unload()).toBe(false);
  await click(screen, "[data-draft-dismiss]");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.submissions).toEqual([]);
});
it("removing one retained draft line does not silently clear protection for a chosen bill", async () => {
  const { app, screen } = await mount();
  await click(screen, "[data-draft-dismiss]");
  await tap(screen, "Beer");
  // Separate lines give Remove a second line to retain.
  app.store.loadFrom(app.store.id, [
    { product: beer, quantity: "1" },
    { product: beer, quantity: "2", noMerge: true },
  ]);
  await screen.updateComplete;
  await click(screen, '[data-draft-action="fire-all"]');
  await choose(screen);
  screen.answerDeadEnds([...app.store.lines], {
    sends: true,
    stations: [],
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
  });
  await screen.updateComplete;
  screen
    .shadowRoot!.querySelector("till-dead-ends-section")!
    .dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await screen.updateComplete;
  expect(app.store.lines.map((line) => line.quantity)).toEqual(["2"]);
  expect(chosen(screen)).toBe("wo-other");
  expect(unload()).toBe(true);
  await click(screen, "[data-draft-dismiss]");
  expect((await question(app)).open).toBe(true);
  expect(app.submissions).toEqual([]);
});
it("Confirm aborts an old question and detached choice events cannot change the next preview", async () => {
  const { app, screen, dialog } = await mount();
  await choose(screen);
  const oldRadio = screen.shadowRoot!.querySelector<HTMLInputElement>('input[value="wo-other"]')!;
  await click(screen, "[data-draft-dismiss]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await click(screen, "[data-draft-confirm]");
  await expect.poll(() => q.open).toBe(false);
  await click(screen, '[data-draft-action="fire-all"]');
  oldDiscard.click();
  oldRadio.dispatchEvent(new Event("change"));
  await screen.updateComplete;
  expect(dialog.open).toBe(true);
  expect(chosen(screen)).toBe("wo-main");
  expect(unload()).toBe(false);
  expect(app.submissions).toHaveLength(1);
});
it("an asynchronous clean Back cannot close a replacement preview", async () => {
  const { screen, dialog } = await mount();
  const back = screen.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!;
  back.click();
  screen.reopenDraftPreview(screen.draftStore!.lines);
  await screen.updateComplete;
  await dialog.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(dialog.open).toBe(true);
  expect(chosen(screen)).toBe("wo-main");
});

it("an enclosing leave asks about this child and resets only its local choice", async () => {
  const { app, screen } = await mount();
  await choose(screen);
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
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
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
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(leaves).toBe(1);
  expect(chosen(screen)).toBe("wo-main");
  expect(app.submissions).toEqual([]);
  expect(unload()).toBe(false);
});
