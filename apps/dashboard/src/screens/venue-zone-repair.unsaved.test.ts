import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LeaveController, type WtCombobox } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-zone-repair.js";
import type { VenueZoneRepair } from "./venue-zone-repair.js";

const view = {
  nodeId: "node",
  legalName: "Deli Test SL",
  country: "ES",
  province: null,
  category: "invalid",
  eligible: true,
  clockRevision: 0,
  choices: ["Europe/Madrid", "Atlantic/Canary"],
  suggestion: "Europe/Madrid",
  admission: { state: "invalid" },
  clock: { dayCutover: "06:00", cutoverChanges: [] },
};
class ZoneLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-venue-zone-repair
        .api=${this.api}
        .canConfigure=${true}
        .admission=${{ state: "invalid" }}
      ></dashboard-venue-zone-repair
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("zone-leave-test-app", ZoneLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount(
  write = vi
    .fn()
    .mockResolvedValue({ repaired: true, clockRevision: 1, admission: "restart_required" }),
) {
  const api = {
    getVenueZoneRepair: vi.fn(async (zone?: string) =>
      zone
        ? {
            ...view,
            preview: {
              timeZone: zone,
              civilDate: "2026-10-15",
              timeOfDay: "01:30:00",
              offsetMinutes: 120,
              businessDay: "2026-10-14",
              dayCutover: "06:00",
              at: "2026-10-14T23:30:00.000Z",
            },
          }
        : view,
    ),
    confirmVenueZone: write,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<ZoneLeaveApp>("zone-leave-test-app", { api });
  const editor = app.shadowRoot!.querySelector("dashboard-venue-zone-repair")!;
  await expect.poll(() => editor.shadowRoot?.querySelector("[name=timeZone]")).not.toBeNull();
  return { app, editor, api };
}
async function change(editor: VenueZoneRepair, name: string, value: string | boolean) {
  editor.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
      bubbles: true,
      composed: true,
    }),
  );
  await editor.updateComplete;
}
async function decide(app: ZoneLeaveApp, choice: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}
it("protects a choice, keeps it on Keep and restores the native controls on Discard", async () => {
  const { app, editor, api } = await mount();
  expect(unload()).toBe(false);
  await change(editor, "timeZone", "Europe/Madrid");
  expect(unload()).toBe(true);
  const kept = app.leave.coordinator.request({ scopes: "all", reason: "signout", proceed() {} });
  await decide(app, "keep");
  expect(await kept).toBe("kept");
  expect(editor.shadowRoot!.querySelector<WtCombobox>("[name=timeZone]")!.value).toBe(
    "Europe/Madrid",
  );
  const discarded = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await decide(app, "discard");
  expect(await discarded).toBe("proceeded");
  expect(editor.shadowRoot!.querySelector<WtCombobox>("[name=timeZone]")!.value).toBe("");
  expect(
    editor
      .shadowRoot!.querySelector("wt-switch")!
      .shadowRoot!.querySelector<HTMLInputElement>("input")!.checked,
  ).toBe(false);
  expect(unload()).toBe(false);
  expect(api.confirmVenueZone).not.toHaveBeenCalled();
});
it("releases a draft on literal revert and retains it after a request refusal", async () => {
  const { editor } = await mount(
    vi.fn().mockRejectedValue({ code: "venue.time_zone_conversion_failed", status: 409 }),
  );
  await change(editor, "timeZone", "Europe/Madrid");
  expect(unload()).toBe(true);
  await change(editor, "timeZone", "");
  expect(unload()).toBe(false);
  await change(editor, "timeZone", "Europe/Madrid");
  await change(editor, "confirmed", true);
  await expect.poll(() => editor.shadowRoot!.querySelector("[data-test=preview]")).not.toBeNull();
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => editor.shadowRoot!.querySelector("wt-form-actions")!.error).toBeTruthy();
  expect(unload()).toBe(true);
});
it("accepts the saved draft before a failed refresh", async () => {
  const { editor, api } = await mount();
  await change(editor, "timeZone", "Europe/Madrid");
  await change(editor, "confirmed", true);
  await expect.poll(() => editor.shadowRoot!.querySelector("[data-test=preview]")).not.toBeNull();
  vi.mocked(api.getVenueZoneRepair).mockRejectedValue({ code: "connection.failed" });
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect
    .poll(() => editor.shadowRoot!.querySelector("[data-test=load-error]"))
    .not.toBeNull();
  expect(unload()).toBe(false);
  expect(editor.shadowRoot!.querySelector("[name=timeZone]")).toBeNull();
});
it("reconnects with the draft protected and a late old response ignored", async () => {
  let finish!: (value: unknown) => void;
  const write = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { editor } = await mount(write);
  await change(editor, "timeZone", "Europe/Madrid");
  await change(editor, "confirmed", true);
  await expect.poll(() => editor.shadowRoot!.querySelector("[data-test=preview]")).not.toBeNull();
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => write.mock.calls.length).toBe(1);
  await reattachAfterDetachedUpdate(editor);
  expect(unload()).toBe(true);
  finish({ repaired: true, clockRevision: 1, admission: "restart_required" });
  await new Promise((r) => setTimeout(r, 0));
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("[name=timeZone]")).not.toBeNull();
  expect(unload()).toBe(true);
});
it("forced session expiry discards the draft without a leave prompt", async () => {
  const { app, editor, api } = await mount();
  await change(editor, "timeZone", "Europe/Madrid");
  expect(unload()).toBe(true);
  app.leave.forceReset();
  editor.remove();
  expect(unload()).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(api.confirmVenueZone).not.toHaveBeenCalled();
});
