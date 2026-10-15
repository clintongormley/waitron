import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import { ShiftEditDialog } from "./shift-edit-dialog.js";
class LeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<rota-shift-dialog
        .open=${true}
        .api=${rotaApi().api}
        .week=${rotaWeek()}
        shiftId="filled"
      ></rota-shift-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("rota-editor-leave-app", LeaveApp);
let app: LeaveApp;
afterEach(() => {
  app?.remove();
  setLocale("en");
});
const unload = () => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};
it("asks before closing an edited shift, keeps it on Keep, then discards on confirmation", async () => {
  setLocale("en");
  app = new LeaveApp();
  document.body.append(app);
  applyTokens(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<ShiftEditDialog>("rota-shift-dialog")!;
  await el.updateComplete;
  expect(unload()).toBe(false);
  el.shadowRoot!.querySelector("[name=endsAt]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "18:00" } }),
  );
  await el.updateComplete;
  expect(unload()).toBe(true);
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const choose = async (choice: string) => {
    const confirm = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await vi.waitFor(() => expect(confirm.open).toBe(true));
    await confirm.updateComplete;
    confirm.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  };
  const keep = modal.requestClose("cancel");
  await choose("keep");
  expect(await keep).toBe(false);
  expect(el.open).toBe(true);
  expect(unload()).toBe(true);
  const discard = modal.requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(unload()).toBe(false);
});
