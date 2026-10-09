import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { RoutingCellEditor, RoutingCellEditorCell } from "./routing-cell-editor.js";
import "./routing-cell-editor.js";

const STORED: RoutingCellEditorCell = {
  address: { row: { kind: "category", categoryId: "cocktails" }, zoneId: null },
  label: "Cocktails, Every zone",
  target: { kind: "station", stationId: "up" },
  periods: [{ periodId: "lunch", target: { kind: "station", stationId: "down" } }],
};

class RoutingCellLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  @property({ attribute: false }) cell: RoutingCellEditorCell = STORED;
  override render() {
    return html`<routing-cell-editor
        .open=${true}
        .cell=${this.cell}
        .periods=${[
          {
            id: "lunch",
            departmentId: "dining",
            departmentName: "Dining",
            name: "Lunch",
            colour: "blue",
            productIds: ["mojito"],
          },
        ]}
        .stations=${[
          { id: "up", name: "Upstairs", active: true },
          { id: "down", name: "Downstairs", active: true },
        ]}
        .rowProductIds=${["mojito"]}
      ></routing-cell-editor
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("routing-cell-leave-test-app", RoutingCellLeaveApp);
let app: RoutingCellLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(cell: RoutingCellEditorCell = STORED) {
  app = document.createElement("routing-cell-leave-test-app") as RoutingCellLeaveApp;
  app.cell = cell;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<RoutingCellEditor>("routing-cell-editor")!;
  await el.updateComplete;
  return el;
}
function target(el: RoutingCellEditor) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=target]");
  expect(field).not.toBeNull();
  return field!;
}
async function change(el: RoutingCellEditor, value: string) {
  target(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function removeLine(el: RoutingCellEditor) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-line]")!.click();
  await el.updateComplete;
}
function modal(el: RoutingCellEditor) {
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal");
  expect(modal).not.toBeNull();
  return modal!;
}
function save(el: RoutingCellEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-cell]")!;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
async function reconnect(el: RoutingCellEditor) {
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  expect(unload()).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
}

it("asks before closing a changed cell; Keep keeps the edit and Discard closes", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, "station:down");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(target(el).value).toBe("station:down");
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("asks before closing when only a period line was removed", async () => {
  const el = await mount();
  await removeLine(el);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await change(el, "station:down");
  await change(el, "station:up");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("closes an untouched inherited cell without asking, though its Save is ready", async () => {
  const el = await mount({ ...STORED, inheritedFrom: "Every zone" });
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("asks for an edit made after removal and reconnect", async () => {
  const el = await mount();
  await reconnect(el);
  await change(el, "station:down");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("retains an edit made before removal and still compares it to the opened values", async () => {
  const el = await mount();
  await change(el, "station:down");
  await reconnect(el);
  expect(target(el).value).toBe("station:down");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("busy and disconnected editors refuse a retained close guard", async () => {
  const el = await mount();
  await change(el, "station:down");
  const guard = modal(el).beforeClose!;
  el.busy = true;
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
  expect((await question()).open).toBe(false);
  el.busy = false;
  el.remove();
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
});
