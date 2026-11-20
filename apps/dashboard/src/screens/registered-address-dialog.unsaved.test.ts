import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog, type WtInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-details-panel.js";

class RegisteredAddressLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-venue-details-panel .api=${this.api}></dashboard-venue-details-panel>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("registered-address-leave-test-app", RegisteredAddressLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const changeTaxpayerDomicile = vi.fn();
  const api = {
    liveData: new LiveData(),
    getVenueDetails: async () => venueDetailsFixture(),
    changeTaxpayerDomicile,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<RegisteredAddressLeaveApp>(
    "registered-address-leave-test-app",
    { api },
  );
  const panel = app.shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect
    .poll(() => panel.shadowRoot?.querySelector("[data-test=change-taxpayer-domicile]"))
    .toBeTruthy();
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-taxpayer-domicile]")!.click();
  const host = panel.shadowRoot!.querySelector("dashboard-registered-address-dialog")!;
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const input = dialog.querySelector<WtInput>("wt-input[name=taxpayerDomicile]")!;
  await input.updateComplete;
  return { app, host, dialog, input, changeTaxpayerDomicile };
}

async function question(app: RegisteredAddressLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

async function choose(app: RegisteredAddressLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

it("an untouched dialog closes on Escape without asking", async () => {
  const { app, dialog, input } = await fixture();
  input.shadowRoot!.querySelector("input")!.focus();
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a typed address asks before Escape, and Keep keeps it", async () => {
  const { app, dialog, input, changeTaxpayerDomicile } = await fixture();
  input.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{End} 2");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(input.value).toBe("Calle Fiscal 8, 28013 Madrid 2");
  expect(changeTaxpayerDomicile).not.toHaveBeenCalled();
});

it("a typed address asks before Escape, and Discard closes without changing the address", async () => {
  const { app, dialog, input, changeTaxpayerDomicile } = await fixture();
  input.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{End} 2");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  const closed = dialogClosed(dialog);
  await choose(app, "discard");
  await closed;
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(changeTaxpayerDomicile).not.toHaveBeenCalled();
});

it("the panel being hidden closes the dialog and releases its draft", async () => {
  const { app, dialog, input, changeTaxpayerDomicile } = await fixture();
  input.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{End} 2");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  const closed = dialogClosed(dialog);
  app
    .shadowRoot!.querySelector("dashboard-venue-details-panel")!
    .dispatchEvent(new Event("venue-settings-hidden"));
  await closed;
  expect(dialog.open).toBe(false);
  expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(changeTaxpayerDomicile).not.toHaveBeenCalled();
});
