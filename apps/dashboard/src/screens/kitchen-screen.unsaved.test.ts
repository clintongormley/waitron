import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./kitchen-screen.js";

class KitchenLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-kitchen-screen .api=${this.api}></dashboard-kitchen-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("kitchen-leave-test-app", KitchenLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-kitchen-screen"];
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  const liveData = new LiveData();
  const api = {
    liveData,
    listCourses: async () => [],
    getBumpMode: async () => ({ mode: "line" }),
    setBumpMode: async () => {},
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<KitchenLeaveApp>("kitchen-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-kitchen-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("[data-test=bump-line]")).toBeTruthy();
  return { app, screen };
}
function click(screen: Screen, test: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: KitchenLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}

for (const result of ["stored", "refused"] as const) {
  it(`the immediate bump choice stays exempt while writing and after ${result}`, async () => {
    const pending = deferred();
    const values: string[] = [];
    const write = async (value: string) => {
      values.push(value);
      await pending.promise;
    };
    const { app, screen } = await mount({ setBumpMode: write });
    const value = "ticket";
    click(screen, `bump-${value}`);
    await screen.updateComplete;
    expect(values).toEqual([value]);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
    if (result === "stored") pending.resolve();
    else pending.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    if (result === "refused")
      expect(
        screen.shadowRoot!.querySelector("[data-test=kitchen-error]")!.textContent!.trim(),
      ).not.toBe("");
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
    expect(values).toEqual([value]);
  });
}
