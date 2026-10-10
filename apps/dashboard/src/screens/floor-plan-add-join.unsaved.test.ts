import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtModal } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DraftTable, FloorPlanDraft } from "./floor-plan-draft.js";
import "./floor-plan-add-join.js";
import type { FloorPlanAddJoin } from "./floor-plan-add-join.js";

const table = (key: string, label: string): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats: 4,
  fixed: false,
  placement: null,
});

const draft: FloorPlanDraft = { tables: [table("m1", "T1"), table("m2", "T2")], joins: [] };

class JoinLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  changes: FloorPlanDraft[] = [];
  #n = 0;
  readonly nextJoinKey = () => `join:${++this.#n}`;
  override render() {
    return html`<floor-plan-add-join
        .draft=${draft}
        .nextJoinKey=${this.nextJoinKey}
        @floor-plan-change=${(e: CustomEvent<{ draft: FloorPlanDraft }>) =>
          this.changes.push(e.detail.draft)}
      ></floor-plan-add-join
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("floor-plan-add-join-leave-test-app", JoinLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<JoinLeaveApp>("floor-plan-add-join-leave-test-app", {});
  const join = app.shadowRoot!.querySelector<FloorPlanAddJoin>("floor-plan-add-join")!;
  await join.updateComplete;
  join.show("m1");
  await join.updateComplete;
  const dialog = join.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-join]")!;
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  return { app, join, dialog };
}

const field = (dialog: WtModal, name: string) =>
  dialog.querySelector<HTMLElement & { value: string; values: string[] }>(`[name=${name}]`)!;

async function question(app: JoinLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

async function choose(app: JoinLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

it("an untouched Add join closes on Escape without asking", async () => {
  const { app, dialog } = await fixture();
  field(dialog, "join-seats").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.changes).toEqual([]);
});

it("a chosen table asks before Escape, and Keep keeps it", async () => {
  const { app, join, dialog } = await fixture();
  await chooseOptions(field(dialog, "join-tables"), ["m2"]);
  await join.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  field(dialog, "join-seats").focus();
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(field(dialog, "join-tables").values).toEqual(["m2"]);
  expect(app.changes).toEqual([]);
});

it("typed seats ask before Cancel, and Discard closes without adding", async () => {
  const { app, join, dialog } = await fixture();
  await chooseOption(field(dialog, "join-seats"), "6");
  await join.updateComplete;
  dialog.querySelector<HTMLElement>("wt-button[data-action=join-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "discard");
  await expect.poll(() => dialog.open).toBe(false);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.changes).toEqual([]);
});

it("an add leaves nothing unsaved in the dialog", async () => {
  const { app, join, dialog } = await fixture();
  await chooseOptions(field(dialog, "join-tables"), ["m2"]);
  await chooseOption(field(dialog, "join-seats"), "6");
  await join.updateComplete;
  dialog.querySelector<HTMLElement>("wt-button[data-action=join-confirm]")!.click();
  await join.updateComplete;
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.changes).toHaveLength(1);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
