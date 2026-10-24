import { LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { FirstSetupBackupScreen } from "./first-setup-backup-screen.js";
import { repairApi, inspection, q, fill } from "../../test/first-setup-backup-browser.js";
class Shell extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = repairApi().api;
  override render() {
    return html`<setup-first-backup .api=${this.api} .inspection=${inspection}></setup-first-backup
      >${this.leave.render({ heading: "Discard changes?", message: "Your changes have not been saved.", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a731-test-shell", Shell);
afterEach(cleanupWidgets);
it("keeps edited proof while editing and clears live secrets and the native file picker on discard", async () => {
  const { el } = await mountWidget<Shell>("a731-test-shell", {});
  const screen = el.shadowRoot!.querySelector<FirstSetupBackupScreen>("setup-first-backup")!;
  await screen.updateComplete;
  await fill(screen, "archive-key", "private archive draft");
  const files = new DataTransfer();
  files.items.add(new File(["encrypted-copy"], "saved.waitron"));
  const picker = q<HTMLInputElement>(screen, "artifact");
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  expect(picker.files!.length).toBe(1);
  expect(el.leave.coordinator.isDirty()).toBe(true);
  let proceeded = false;
  async function choose(decision: "keep" | "discard") {
    const pending = el.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        proceeded = true;
      },
    });
    await expect
      .poll(
        () =>
          el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-unsaved-changes")!.open,
      )
      .toBe(true);
    el.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
    return pending;
  }
  expect(await choose("keep")).toBe("kept");
  expect(proceeded).toBe(false);
  expect(picker.files!.length).toBe(1);
  expect(await choose("discard")).toBe("proceeded");
  await screen.updateComplete;
  expect(picker.files!.length).toBe(0);
  const archiveKey = q<LitElement>(screen, "archive-key");
  await archiveKey.updateComplete;
  expect(archiveKey.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(el.leave.coordinator.isDirty()).toBe(false);
});
