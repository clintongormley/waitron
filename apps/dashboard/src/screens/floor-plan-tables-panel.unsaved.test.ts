import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtModal } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { FloorPlanDraft } from "./floor-plan-draft.js";
import "./floor-plan-tables-panel.js";
import type { FloorPlanTablesPanel } from "./floor-plan-tables-panel.js";

const draft: FloorPlanDraft = {
  tables: [
    {
      key: "m1",
      id: "m1",
      liveTableId: null,
      label: "Terrace 1",
      seats: 4,
      fixed: false,
      placement: null,
    },
  ],
  joins: [],
};

class PanelLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  changes: FloorPlanDraft[] = [];
  #n = 0;
  readonly nextKey = () => `new:${++this.#n}`;
  override render() {
    return html`<floor-plan-tables-panel
        .draft=${draft}
        zoneName="Terrace"
        .nextKey=${this.nextKey}
        @floor-plan-change=${(e: CustomEvent<{ draft: FloorPlanDraft }>) =>
          this.changes.push(e.detail.draft)}
      ></floor-plan-tables-panel
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("floor-plan-panel-leave-test-app", PanelLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PanelLeaveApp>("floor-plan-panel-leave-test-app", {});
  const panel = app.shadowRoot!.querySelector<FloorPlanTablesPanel>("floor-plan-tables-panel")!;
  await panel.updateComplete;
  panel.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!.click();
  await panel.updateComplete;
  const dialog = panel.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-tables]")!;
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  return { app, panel, dialog };
}

const field = (dialog: WtModal, name: string) =>
  dialog.querySelector<HTMLElement & { value: string }>(`[name=${name}]`)!;

async function set(panel: FloorPlanTablesPanel, el: Element, value: string): Promise<void> {
  await chooseOption(el, value);
  await panel.updateComplete;
}

async function question(app: PanelLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

async function choose(app: PanelLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

it("an untouched Add tables closes on Escape without asking", async () => {
  const { app, dialog } = await fixture();
  field(dialog, "prefix").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.changes).toEqual([]);
});

it("typed custom names ask before Escape, and Keep keeps them", async () => {
  const { app, panel, dialog } = await fixture();
  await set(panel, field(dialog, "table-count"), "2");
  await set(panel, field(dialog, "naming"), "custom");
  const name = field(dialog, "table-name");
  await set(panel, name, "Patio 1");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  name.focus();
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(field(dialog, "table-name").value).toBe("Patio 1");
  expect(field(dialog, "table-count").value).toBe("2");
  expect(app.changes).toEqual([]);
});

it("a changed count asks before Cancel, and Discard closes without adding", async () => {
  const { app, panel, dialog } = await fixture();
  await set(panel, field(dialog, "table-count"), "3");
  dialog.querySelector<HTMLElement>("wt-button[data-action=add-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "discard");
  await expect.poll(() => dialog.open).toBe(false);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.changes).toEqual([]);
});

it("a count changed back is clean again", async () => {
  const { app, panel, dialog } = await fixture();
  await set(panel, field(dialog, "table-count"), "3");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await set(panel, field(dialog, "table-count"), "1");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("an add leaves nothing unsaved in the dialog", async () => {
  const { app, panel, dialog } = await fixture();
  await set(panel, field(dialog, "table-count"), "2");
  dialog.querySelector<HTMLElement>("wt-button[data-action=add-confirm]")!.click();
  await panel.updateComplete;
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.changes).toHaveLength(1);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
