import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./equipment-profile-picker.js";

class EquipmentProfilesApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly save = vi.fn().mockRejectedValueOnce({ code: "management.request_invalid" });
  readonly assignment = {
    kind: "reader",
    name: "Restored card reader",
    load: async () => [{ id: "till", name: "Till", eligible: true }],
    save: this.save,
  };

  override render() {
    return html`<dashboard-equipment-profile-picker .assignment=${this.assignment}>
      </dashboard-equipment-profile-picker>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Discard your changes?",
        keepLabel: "Keep editing",
        discardLabel: "Discard changes",
      })}`;
  }
}
customElements.define("test-equipment-profiles-app", EquipmentProfilesApp);
afterEach(cleanupWidgets);

it("retries a refused profile load and explains an empty choice list", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce({ code: "management.request_invalid" })
    .mockResolvedValueOnce([]);
  const save = vi.fn();
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-equipment-profile-picker"]>(
    "dashboard-equipment-profile-picker",
    { assignment: { kind: "reader", name: "Restored card reader", load, save } },
  );
  const actions = () => el.shadowRoot!.querySelector("wt-form-actions")!;
  await expect.poll(() => actions().error).toBe(codeMessage("management.request_invalid"));
  const retry = actions().querySelector('wt-button[variant="primary"]')!;
  expect(retry.textContent?.trim()).toBe(t("equipment_profiles.retry"));
  await userEvent.click(retry);
  await expect.poll(() => el.shadowRoot!.textContent).toContain(t("equipment_profiles.empty"));
  expect(actions().error).toBe("");
  expect(actions().querySelector('[data-test="save-equipment-profiles"]')).toHaveProperty(
    "disabled",
    true,
  );
});

it("keeps changed ticks after a refusal and protects them until a retry succeeds", async () => {
  const { el } = await mountWidget<EquipmentProfilesApp>("test-equipment-profiles-app", {});
  const picker = el.shadowRoot!.querySelector("dashboard-equipment-profile-picker")!;
  const tick = () => picker.shadowRoot?.querySelector<HTMLInputElement>("input");
  await expect.poll(() => tick()).toBeTruthy();
  expect(tick()!.checked).toBe(false);
  await userEvent.click(tick()!);
  const canLeave = () => window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
  expect(canLeave()).toBe(false);
  const dialog = picker.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  const save = picker.shadowRoot!.querySelector<HTMLElement>(
    "[data-test=save-equipment-profiles]",
  )!;
  save.click();
  await expect.poll(() => el.save.mock.calls).toEqual([[["till"]]]);
  await expect.poll(() => picker.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  expect(tick()!.checked).toBe(true);

  const escape = dialog.requestClose("navigation");
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await escape).toBe(false);
  expect(tick()!.checked).toBe(true);

  const closed = new Promise((resolve) =>
    dialog.addEventListener("wt-close", resolve, { once: true }),
  );
  save.click();
  await closed;
  expect(canLeave()).toBe(true);
  expect(el.save.mock.calls).toEqual([[["till"]], [["till"]]]);
});
