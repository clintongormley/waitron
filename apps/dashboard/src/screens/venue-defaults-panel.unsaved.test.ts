import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LeaveController, type WtCombobox } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-defaults-panel.js";

class DefaultsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-venue-defaults-panel .api=${this.api}></dashboard-venue-defaults-panel>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("venue-defaults-leave-test-app", DefaultsLeaveApp);
type Panel = HTMLElementTagNameMap["dashboard-venue-defaults-panel"];

const MADRID: VenueDefaults = {
  receiptLanguage: "es-ES",
  receiptLanguageChoices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  fixedReceiptLanguage: null,
  defaultProductVatClass: "reduced",
};
const BARCELONA: VenueDefaults = {
  ...MADRID,
  receiptLanguageChoices: ["ca-ES"],
  fixedReceiptLanguage: "ca-ES",
};

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(stored: VenueDefaults = MADRID) {
  let current = structuredClone(stored);
  const writes: Partial<VenueDefaults>[] = [];
  const liveData = new LiveData();
  const api = {
    liveData,
    getVenueDefaults: async () => structuredClone(current),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "ca"] }),
    putVenueDefaults: async (changes: Partial<VenueDefaults>) => {
      writes.push(structuredClone(changes));
      current = { ...current, ...changes };
      return structuredClone(current);
    },
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<DefaultsLeaveApp>("venue-defaults-leave-test-app", { api });
  const panel = app.shadowRoot!.querySelector("dashboard-venue-defaults-panel")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  click(panel, "edit");
  await expect.poll(() => field(panel, "receiptLanguage")).toBeTruthy();
  return { app, panel, writes, liveData };
}
const field = (panel: Panel, name: string) =>
  panel.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name=${name}]`);
async function change(panel: Panel, name: string, value: string) {
  field(panel, name)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await panel.updateComplete;
}
function click(panel: Panel, action: string) {
  panel.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: DefaultsLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: DefaultsLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}
const viewing = (panel: Panel) => panel.shadowRoot!.querySelector("[data-test=edit]") !== null;

it("Keep on leaving with a changed draft keeps it", async () => {
  const { app, panel } = await mount();
  await change(panel, "defaultProductVatClass", "zero");
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(field(panel, "defaultProductVatClass")!.value).toBe("zero");
  expect(unload()).toBe(true);
});

it("Discard on leaving with a changed draft restores the saved values without a write", async () => {
  const { app, panel, writes } = await mount();
  await change(panel, "receiptLanguage", "gl-ES");
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await panel.updateComplete;
  expect(field(panel, "receiptLanguage")?.value ?? "es-ES").toBe("es-ES");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("a reverted draft leaves without asking", async () => {
  const { app, panel } = await mount();
  await change(panel, "defaultProductVatClass", "zero");
  await change(panel, "defaultProductVatClass", "reduced");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("Cancel asks with a changed draft: Keep stays, Discard returns to view mode", async () => {
  const { app, panel, writes } = await mount();
  await change(panel, "defaultProductVatClass", "zero");
  click(panel, "cancel");
  await choose(app, "keep");
  expect(field(panel, "defaultProductVatClass")!.value).toBe("zero");
  click(panel, "cancel");
  await choose(app, "discard");
  await expect.poll(() => viewing(panel)).toBe(true);
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("reconnecting keeps the draft and its protection", async () => {
  const { app, panel } = await mount();
  await change(panel, "defaultProductVatClass", "zero");
  panel.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(panel);
  await panel.updateComplete;
  await expect.poll(() => field(panel, "defaultProductVatClass")?.value).toBe("zero");
  expect(unload()).toBe(true);
});

it("removing the card releases protection", async () => {
  const { panel } = await mount();
  await change(panel, "defaultProductVatClass", "zero");
  expect(unload()).toBe(true);
  panel.remove();
  expect(unload()).toBe(false);
});

it("being hidden ends an unchanged edit and keeps a changed one", async () => {
  const { panel } = await mount();
  await change(panel, "defaultProductVatClass", "zero");
  panel.dispatchEvent(new Event("venue-settings-hidden"));
  await panel.updateComplete;
  expect(field(panel, "defaultProductVatClass")!.value).toBe("zero");
  expect(unload()).toBe(true);
  await change(panel, "defaultProductVatClass", "reduced");
  panel.dispatchEvent(new Event("venue-settings-hidden"));
  await panel.updateComplete;
  expect(field(panel, "defaultProductVatClass")).toBeNull();
  expect(viewing(panel)).toBe(true);
  expect(unload()).toBe(false);
});

it("a Barcelona venue stored in Spanish: an untouched Edit asks on leaving, and Discard returns to view mode without a write", async () => {
  const { app, panel, writes } = await mount(BARCELONA);
  expect(field(panel, "receiptLanguage")!.value).toBe("ca-ES");
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await expect.poll(() => viewing(panel)).toBe(true);
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("a Barcelona venue stored in Spanish: Save on the untouched Edit sends Catalan", async () => {
  const { panel, writes } = await mount(BARCELONA);
  click(panel, "save");
  await expect.poll(() => viewing(panel)).toBe(true);
  expect(writes).toEqual([{ receiptLanguage: "ca-ES" }]);
  expect(unload()).toBe(false);
});
