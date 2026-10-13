import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtModal } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DraftTable, FloorPlanDraft } from "./floor-plan-draft.js";
import "./floor-plan-add-joined-table.js";
import type { FloorPlanAddJoinedTable } from "./floor-plan-add-joined-table.js";

const table = (key: string, label: string, seats: number): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats,
  fixed: false,
  placement: null,
  parts: null,
  keptSize: null,
});

const draft: FloorPlanDraft = {
  tables: [table("c3", "Counter 3", 2), table("c4", "Counter 4", 6), table("c5", "Counter 5", 4)],
};

class JoinedLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  changes: FloorPlanDraft[] = [];
  #n = 0;
  readonly nextKey = () => `new:${++this.#n}`;
  override render() {
    return html`<floor-plan-add-joined-table
        .draft=${draft}
        .nextKey=${this.nextKey}
        @floor-plan-change=${(e: CustomEvent<{ draft: FloorPlanDraft }>) =>
          this.changes.push(e.detail.draft)}
      ></floor-plan-add-joined-table
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("floor-plan-joined-leave-test-app", JoinedLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<JoinedLeaveApp>("floor-plan-joined-leave-test-app", {});
  const panel = app.shadowRoot!.querySelector<FloorPlanAddJoinedTable>(
    "floor-plan-add-joined-table",
  )!;
  await panel.updateComplete;
  panel.show();
  await panel.updateComplete;
  const dialog = panel.shadowRoot!.querySelector<WtModal>(
    "wt-modal[data-dialog=add-joined-table]",
  )!;
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  return { app, panel, dialog };
}

const field = (dialog: WtModal, name: string) =>
  dialog.querySelector<HTMLElement & { value: string; values: string[] }>(`[name=${name}]`)!;

async function set(panel: FloorPlanAddJoinedTable, el: Element, value: string): Promise<void> {
  await chooseOption(el, value);
  await panel.updateComplete;
}

async function question(app: JoinedLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

async function choose(app: JoinedLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

it("an untouched Add joined table closes on Escape without asking", async () => {
  const { app, dialog } = await fixture();
  field(dialog, "table-name").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.changes).toEqual([]);
});

it("a typed name asks before Escape, and Keep keeps it", async () => {
  const { app, panel, dialog } = await fixture();
  const name = field(dialog, "table-name");
  await set(panel, name, "Long table");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  name.focus();
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(field(dialog, "table-name").value).toBe("Long table");
  expect(app.changes).toEqual([]);
});

it("chosen tables ask before Cancel, and Discard closes without adding", async () => {
  const { app, panel, dialog } = await fixture();
  await chooseOptions(field(dialog, "made-of"), ["c3", "c4"]);
  await panel.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  dialog.querySelector<HTMLElement>("wt-button[data-action=add-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "discard");
  await expect.poll(() => dialog.open).toBe(false);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.changes).toEqual([]);
});

it("seats changed back to empty are clean again", async () => {
  const { app, panel, dialog } = await fixture();
  await set(panel, field(dialog, "seats"), "10");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await set(panel, field(dialog, "seats"), "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("an add leaves nothing unsaved in the window", async () => {
  const { app, panel, dialog } = await fixture();
  await set(panel, field(dialog, "table-name"), "Long table");
  await set(panel, field(dialog, "seats"), "10");
  await chooseOptions(field(dialog, "made-of"), ["c3", "c4", "c5"]);
  await panel.updateComplete;
  dialog.querySelector<HTMLElement>("wt-button[data-action=add-confirm]")!.click();
  await panel.updateComplete;
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.changes).toHaveLength(1);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
