import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import "./upgrade-settings-dialog.js";

class UpgradeSettingsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = new DashboardApi("", async () =>
    Response.json({ version: 1, revision: 1, automatic: false, start: "02:00", end: "05:00" }),
  );
  override render() {
    return html`<button
        @click=${(event: Event) =>
          this.renderRoot
            .querySelector("dashboard-upgrade-settings-dialog")
            ?.show(event.currentTarget as HTMLElement)}
      >
        Open
      </button>
      <dashboard-upgrade-settings-dialog .api=${this.api}></dashboard-upgrade-settings-dialog>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("upgrade-settings-leave-test-app", UpgradeSettingsLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it("keeps the edited window on Escape and discards it on Cancel", async () => {
  const { el } = await mountWidget<UpgradeSettingsLeaveApp>("upgrade-settings-leave-test-app", {});
  await userEvent.click(el.shadowRoot!.querySelector("button")!);
  const editor = el.shadowRoot!.querySelector("dashboard-upgrade-settings-dialog")!;
  const dialog = editor.shadowRoot!.querySelector("wt-dialog")!;
  const start = () =>
    dialog.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=start]")!;
  await expect.poll(() => start()?.value).toBe("02:00");
  const native = start().shadowRoot!.querySelector("input")!;
  native.value = "01:30";
  native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await userEvent.keyboard("{Escape}");

  const warning = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await userEvent.click(warning.shadowRoot!.querySelector("[data-choice=keep]")!);
  await expect.poll(() => warning.open).toBe(false);
  expect(native.value).toBe("01:30");

  const closed = dialogClosed(dialog);
  await userEvent.click(dialog.querySelector('wt-button[slot="cancel"]')!);
  await closed;
  expect(warning.open).toBe(false);
  await userEvent.click(el.shadowRoot!.querySelector("button")!);
  await expect.poll(() => start()?.value).toBe("02:00");
});
