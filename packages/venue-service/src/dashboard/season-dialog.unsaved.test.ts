import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SeasonDialog } from "./season-dialog.js";
import "./season-dialog.js";

const winter = { id: "w", name: "Winter", startsOn: "12-01", lastDay: "02-28" };
const spring = { id: "sp", name: "Spring", startsOn: "03-01", lastDay: "11-30" };

class SeasonLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<season-dialog
        .open=${true}
        .season=${winter}
        .seasons=${[spring, winter]}
      ></season-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("season-leave-test-app", SeasonLeaveApp);
let app: SeasonLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("season-leave-test-app") as SeasonLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<SeasonDialog>("season-dialog")!;
  await el.updateComplete;
  return el;
}
async function change(el: SeasonDialog, name: string, value: string) {
  const field = el.shadowRoot!.querySelector(`[name="${name}"]`);
  expect(field).not.toBeNull();
  field!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const modal = (el: SeasonDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
const save = (el: SeasonDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-season]")!;
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

it("asks before closing a changed season and Keep preserves the editor", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, "startMonth", "11");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=startMonth]")!.value,
  ).toBe("11");
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await change(el, "name", "Cold");
  await change(el, "name", "Winter");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("refuses a close asked for in the same turn a request starts, without asking about the changes", async () => {
  const el = await mount();
  await change(el, "name", "Cold");
  el.pending = "save";
  const close = modal(el).requestClose("escape");
  const question = () =>
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  const asked = expect
    .poll(() => question().open)
    .toBe(true)
    .then(
      () => "asked",
      () => "never asked",
    );
  expect(await Promise.race([close, asked])).toBe(false);
  expect(question().open).toBe(false);
  expect(el.open).toBe(true);
});
