import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { casaMarina } from "./floor-plans-fixture.js";
import type { FloorPlanSetDialog, FloorPlanSetMode } from "./floor-plan-set-dialog.js";
import "./floor-plan-set-dialog.js";

class SetLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  mode: FloorPlanSetMode = "add";
  override render() {
    return html`<dashboard-floor-plan-set-dialog
        .open=${true}
        .mode=${this.mode}
        .departments=${casaMarina().departments}
        .set=${{ id: "dinner", name: "Dinner" }}
      ></dashboard-floor-plan-set-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("floor-plan-set-leave-test-app", SetLeaveApp);
let app: SetLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(mode: FloorPlanSetMode) {
  app = document.createElement("floor-plan-set-leave-test-app") as SetLeaveApp;
  app.mode = mode;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<FloorPlanSetDialog>("dashboard-floor-plan-set-dialog")!;
  await el.updateComplete;
  return el;
}
async function change(el: FloorPlanSetDialog, name: string, value: string) {
  el.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const modal = (el: FloorPlanSetDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
const save = (el: FloorPlanSetDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-set]")!;
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}

it("asks before closing a changed new set; Keep keeps it, Discard closes", async () => {
  const el = await mount("add");
  expect(unload()).toBe(false);
  await change(el, "departmentId", "restaurant");
  await change(el, "name", "Brunch");
  expect(unload()).toBe(true);
  const kept = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await kept).toBe(false);
  expect(el.open).toBe(true);
  const discarded = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discarded).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("a rename put back to the set's name is quiet and closes without asking", async () => {
  const el = await mount("rename");
  await change(el, "name", "Evening");
  expect(save(el).variant).toBe("primary");
  await change(el, "name", "Dinner ");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("a saved submission becomes the baseline, so closing after it asks nothing", async () => {
  const el = await mount("copy");
  await change(el, "name", "Party");
  save(el).click();
  expect(el.commitSubmitted()).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});
