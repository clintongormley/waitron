import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { CatalogueSettings, DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./catalogue-settings-panel.js";

class DefaultsLeaveHost extends LitElement {
  api!: DashboardApi;
  readonly leave = new LeaveController(this);
  override render() {
    return html`<dashboard-catalogue-settings-panel
        .api=${this.api}
      ></dashboard-catalogue-settings-panel>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("defaults-leave-test-host", DefaultsLeaveHost);
afterEach(cleanupWidgets);

it("keeps or discards the pending default and clears the leave guard only after save succeeds", async () => {
  const api = {
    liveData: new LiveData(),
    getCatalogueSettings: async () => ({ defaultProductVatClass: "reduced", defaultColor: null }),
    saveCatalogueSettings: async (value: Pick<CatalogueSettings, "defaultProductVatClass">) => ({
      ...value,
      defaultColor: null,
    }),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<DefaultsLeaveHost>("defaults-leave-test-host", { api });
  const panel = app.shadowRoot!.querySelector("dashboard-catalogue-settings-panel")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("wt-combobox")).toBeTruthy();
  const field = () => panel.shadowRoot!.querySelector("wt-combobox")!;
  const change = async (value: string) => {
    field().dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await panel.updateComplete;
  };
  await change("zero");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  const choose = async (choice: "keep" | "discard") => {
    const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => warning.open).toBe(true);
    warning.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: choice },
        bubbles: true,
        composed: true,
      }),
    );
  };
  const first = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await choose("keep");
  expect(await first).toBe("kept");
  expect(field().value).toBe("zero");
  const second = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await choose("discard");
  expect(await second).toBe("proceeded");
  await panel.updateComplete;
  expect(field().value).toBe("reduced");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await change("super_reduced");
  panel.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(false);
  expect(field().value).toBe("super_reduced");
});
