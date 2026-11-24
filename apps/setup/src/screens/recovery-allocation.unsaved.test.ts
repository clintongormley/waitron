import { LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { encodeMasterKeyCode } from "@waitron/shared";
import { cleanupWidgets, mountWidget, typeMasterKey } from "../widgets/test-helpers.js";
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
const MASTER_KEY = encodeMasterKeyCode(new Uint8Array(16).fill(5));
afterEach(cleanupWidgets);
it("keeps the node key while editing and clears the native field on Discard", async () => {
  const { el } = await mountWidget<TestShell>("recovery-allocation-test-shell", {});
  const entry = el.shadowRoot!.querySelector<SetupRecoveryAllocation>("setup-recovery-allocation")!;
  await entry.updateComplete;
  await typeMasterKey(entry, MASTER_KEY);
  await entry.updateComplete;
  const field = entry
    .shadowRoot!.querySelector("wt-master-key-input")!
    .shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[name="master-key"]',
    )!;
  const native = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(native.value).toBe(MASTER_KEY);
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
  expect(native.value).toBe(MASTER_KEY);
  expect(await choose("discard")).toBe("proceeded");
  await entry.updateComplete;
  await field.updateComplete;
  expect(native.value).toBe("");
  expect(entry.readCredentials()).toBeNull();
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
  await typeMasterKey(entry, MASTER_KEY);
  expect(el.leave.coordinator.isDirty([entry])).toBe(true);
});

it("counts a partly typed key as the restore entry's draft, and Discard clears it", async () => {
  const { el } = await mountWidget<TestShell>("recovery-allocation-test-shell", {});
  const entry = el.shadowRoot!.querySelector<SetupRecoveryAllocation>("setup-recovery-allocation")!;
  await entry.updateComplete;
  await typeMasterKey(entry, "ABCD");
  await entry.updateComplete;
  expect(el.leave.coordinator.isDirty([entry])).toBe(true);
  const pending = el.leave.coordinator.request({
    scopes: [entry],
    reason: "navigation",
    proceed() {},
  });
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await pending).toBe("proceeded");
  const field = entry
    .shadowRoot!.querySelector("wt-master-key-input")!
    .shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[name="master-key"]',
    )!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(el.leave.coordinator.isDirty([entry])).toBe(false);
});
