import { LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";

class TestShell extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<setup-recovery-allocation></setup-recovery-allocation>${this.leave.render({
        heading: "Discard unsaved changes?",
        message: "Your changes have not been saved.",
        keepLabel: "Keep editing",
        discardLabel: "Discard changes",
      })}`;
  }
}
customElements.define("recovery-allocation-test-shell", TestShell);
afterEach(cleanupWidgets);
it("keeps the node key while editing and clears the native field on Discard", async () => {
  const { el } = await mountWidget<TestShell>("recovery-allocation-test-shell", {});
  const entry = el.shadowRoot!.querySelector<SetupRecoveryAllocation>("setup-recovery-allocation")!;
  await entry.updateComplete;
  const field = entry.shadowRoot!.querySelector("[data-test=node-key]")!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "node-key-secret" } }));
  await entry.updateComplete;
  const native = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(native.value).toBe("node-key-secret");
  expect(el.leave.coordinator.isDirty([entry])).toBe(true);
  let proceeded = false;
  const leave = () =>
    el.leave.coordinator.request({
      scopes: [entry],
      reason: "navigation",
      proceed: () => {
        proceeded = true;
      },
    });
  async function choose(decision: "keep" | "discard") {
    const pending = leave();
    await el.updateComplete;
    el.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
    return pending;
  }
  expect(await choose("keep")).toBe("kept");
  expect(proceeded).toBe(false);
  expect(native.value).toBe("node-key-secret");
  expect(await choose("discard")).toBe("proceeded");
  await entry.updateComplete;
  await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(native.value).toBe("");
  expect(entry.readCredentials()).toBeUndefined();
  expect(el.leave.coordinator.isDirty([entry])).toBe(false);
});

it("tracks the first key edit after the entry is removed and reattached", async () => {
  const { el } = await mountWidget<TestShell>("recovery-allocation-test-shell", {});
  const entry = el.shadowRoot!.querySelector<SetupRecoveryAllocation>("setup-recovery-allocation")!;
  await entry.updateComplete;
  const parent = entry.parentNode!;
  entry.remove();
  await entry.updateComplete;
  parent.appendChild(entry);
  entry
    .shadowRoot!.querySelector("[data-test=node-key]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "new-node-key" } }));
  expect(el.leave.coordinator.isDirty([entry])).toBe(true);
});
