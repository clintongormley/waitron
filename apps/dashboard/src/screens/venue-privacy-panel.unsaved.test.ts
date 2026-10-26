import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, type WtInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, VenuePrivacy } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-privacy-panel.js";

class PrivacyLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-venue-privacy-panel .api=${this.api}></dashboard-venue-privacy-panel>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("venue-privacy-leave-test-app", PrivacyLeaveApp);
type Panel = HTMLElementTagNameMap["dashboard-venue-privacy-panel"];

const STORED: VenuePrivacy = {
  privacyNoticeUrl: "https://example.com/privacy",
  privacyEmail: "privacy@example.com",
};

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(stored: VenuePrivacy = STORED) {
  const state = { current: structuredClone(stored) };
  const writes: Partial<Record<keyof VenuePrivacy, string>>[] = [];
  const liveData = new LiveData();
  const api = {
    liveData,
    getVenuePrivacy: async () => structuredClone(state.current),
    putVenuePrivacy: async (changes: Partial<Record<keyof VenuePrivacy, string>>) => {
      writes.push(structuredClone(changes));
      state.current = { ...state.current, ...changes };
      return structuredClone(state.current);
    },
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<PrivacyLeaveApp>("venue-privacy-leave-test-app", { api });
  const panel = app.shadowRoot!.querySelector("dashboard-venue-privacy-panel")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  click(panel, "edit");
  await expect.poll(() => field(panel, "privacyNoticeUrl")).toBeTruthy();
  await field(panel, "privacyNoticeUrl")!.updateComplete;
  await field(panel, "privacyEmail")!.updateComplete;
  return { app, panel, writes, liveData, state };
}
const field = (panel: Panel, name: string) =>
  panel.shadowRoot!.querySelector<WtInput>(`wt-input[name=${name}]`);
async function type(panel: Panel, name: string, value: string) {
  const native = field(panel, name)!.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(native), value);
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
function leave(app: PrivacyLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: PrivacyLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}
const viewing = (panel: Panel) => panel.shadowRoot!.querySelector("[data-test=edit]") !== null;
const saved = (panel: Panel, name: string) =>
  panel.shadowRoot!.querySelector(`[data-test=saved-${name}]`)!.textContent!.trim();

it("Keep on leaving with a changed draft keeps it", async () => {
  const { app, panel } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(field(panel, "privacyEmail")!.value).toBe("typed@example.com");
  expect(unload()).toBe(true);
});

it("Discard on leaving with a changed draft restores the saved values without a write", async () => {
  const { app, panel, writes } = await mount();
  await type(panel, "privacyNoticeUrl", "https://example.com/other");
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await panel.updateComplete;
  await expect.poll(() => viewing(panel)).toBe(true);
  expect(saved(panel, "privacyNoticeUrl")).toBe("https://example.com/privacy");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("a reverted draft leaves without asking", async () => {
  const { app, panel } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  await type(panel, "privacyEmail", "privacy@example.com");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("a draft that only added spaces around the stored web page leaves without asking", async () => {
  const { app, panel } = await mount();
  await type(panel, "privacyNoticeUrl", "  https://example.com/privacy  ");
  expect(field(panel, "privacyNoticeUrl")!.value).toBe("  https://example.com/privacy  ");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("Cancel asks with a changed draft: Keep stays, Discard returns to view mode", async () => {
  const { app, panel, writes } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  click(panel, "cancel");
  await choose(app, "keep");
  expect(field(panel, "privacyEmail")!.value).toBe("typed@example.com");
  click(panel, "cancel");
  await choose(app, "discard");
  await expect.poll(() => viewing(panel)).toBe(true);
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("reconnecting keeps the draft and its protection", async () => {
  const { app, panel } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  panel.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(panel);
  await panel.updateComplete;
  await expect.poll(() => field(panel, "privacyEmail")?.value).toBe("typed@example.com");
  expect(unload()).toBe(true);
});

it("removing the card releases protection", async () => {
  const { panel } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  expect(unload()).toBe(true);
  panel.remove();
  expect(unload()).toBe(false);
});

it("being hidden ends an unchanged edit and keeps a changed one", async () => {
  const { panel } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  panel.dispatchEvent(new Event("venue-settings-hidden"));
  await panel.updateComplete;
  expect(field(panel, "privacyEmail")!.value).toBe("typed@example.com");
  expect(unload()).toBe(true);
  await type(panel, "privacyEmail", "privacy@example.com");
  panel.dispatchEvent(new Event("venue-settings-hidden"));
  await panel.updateComplete;
  expect(field(panel, "privacyEmail")).toBeNull();
  expect(viewing(panel)).toBe(true);
  expect(unload()).toBe(false);
});

it("turning read-only with a changed draft drops the draft and its protection", async () => {
  const { app, panel, writes } = await mount();
  await type(panel, "privacyEmail", "typed@example.com");
  expect(unload()).toBe(true);
  panel.readOnly = true;
  await panel.updateComplete;
  expect(field(panel, "privacyEmail")).toBeNull();
  expect(saved(panel, "privacyEmail")).toBe("privacy@example.com");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
  expect(writes).toEqual([]);
});
