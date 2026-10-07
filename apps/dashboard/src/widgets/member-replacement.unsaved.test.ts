import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./member-list-editor.js";

registerIcons(DASHBOARD_ICONS);
class MemberReplacementLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<dashboard-member-list-editor
        .members=${[{ id: "missing", position: 0, ref: { kind: "missing", name: "Old soup" } }]}
        .replaceable=${new Set(["missing"])}
        .products=${[
          { id: "soup", name: "Soup" },
          { id: "salad", name: "Salad" },
        ]}
        label="Lunch shortcuts"
      ></dashboard-member-list-editor>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("member-replacement-leave-test-app", MemberReplacementLeaveApp);
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<MemberReplacementLeaveApp>(
    "member-replacement-leave-test-app",
    {},
  );
  const editor = app.shadowRoot!.querySelector("dashboard-member-list-editor")!;
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=replace-missing]")!.click();
  await editor.updateComplete;
  return { app, editor };
}
type Editor = HTMLElementTagNameMap["dashboard-member-list-editor"];
async function choose(editor: Editor, value: string) {
  await chooseOption(editor.shadowRoot!.querySelector("wt-combobox")!, value);
  await editor.updateComplete;
}
function cancel(editor: Editor) {
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=replace-cancel]")!.click();
}
async function question(app: MemberReplacementLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
it("replacement Cancel keeps the pending choice until Discard", async () => {
  const { app, editor } = await mount();
  await choose(editor, "product:soup");
  cancel(editor);
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(editor.shadowRoot!.querySelector("wt-combobox")!.value).toBe("product:soup");
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(editor.shadowRoot!.querySelector("[data-test=replace-cancel]")).not.toBeNull();
  expect(editor.shadowRoot!.querySelector("wt-combobox")!.value).toBe("product:soup");
  cancel(editor);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect
    .poll(() => editor.shadowRoot!.querySelector("[data-test=replace-cancel]"))
    .toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(editor.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
});
it("replacement choice protects unload and a clean replacement cancels directly", async () => {
  const { app, editor } = await mount();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(editor);
  await expect
    .poll(() => editor.shadowRoot!.querySelector("[data-test=replace-cancel]"))
    .toBeNull();
  expect((await question(app)).open).toBe(false);
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=replace-missing]")!.click();
  await editor.updateComplete;
  await choose(editor, "product:salad");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
it("replacement refusal retains the submitted choice and successful acceptance clears it", async () => {
  const { app, editor } = await mount();
  await choose(editor, "product:soup");
  const complete = editor.replacementCompletion("missing");
  complete("Request refused");
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("Request refused");
  cancel(editor);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  complete("");
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("[data-test=replace-cancel]")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
it("a successful replacement invalidates its pending discard answer", async () => {
  const { app, editor } = await mount();
  await choose(editor, "product:soup");
  const complete = editor.replacementCompletion("missing");
  cancel(editor);
  const q = await question(app);
  expect(q.open).toBe(true);
  complete("");
  await expect.poll(() => q.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(editor.shadowRoot!.querySelector("[data-test=replace-cancel]")).toBeNull();
});
it("accepting a submitted choice retains newer replacement input", async () => {
  const { app, editor } = await mount();
  await choose(editor, "product:soup");
  const complete = editor.replacementCompletion("missing");
  await choose(editor, "product:salad");
  complete("");
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-combobox")!.value).toBe("product:salad");
  cancel(editor);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  await choose(editor, "product:soup");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("replacement identity changes invalidate a question without erasing the new owner", async () => {
  const { app, editor } = await mount();
  await choose(editor, "product:soup");
  const complete = editor.replacementCompletion("missing");
  cancel(editor);
  const q = await question(app);
  expect(q.open).toBe(true);
  editor.replacementScope = "another-layout";
  await editor.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=replace-missing]")!.click();
  await editor.updateComplete;
  await choose(editor, "product:salad");
  complete("");
  expect(editor.shadowRoot!.querySelector("wt-combobox")!.value).toBe("product:salad");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("immediate member additions stay exempt from a pending replacement draft", async () => {
  const { app, editor } = await mount();
  cancel(editor);
  await editor.updateComplete;
  const adds: unknown[] = [];
  editor.addEventListener("wt-member-add", (event) => adds.push((event as CustomEvent).detail));
  await choose(editor, "product:soup");
  expect(adds).toEqual([{ ref: { kind: "product", productId: "soup" } }]);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
