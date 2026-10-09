import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./department-zones.js";
class App extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<department-zones></department-zones
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a9-zones-leave-app", App);
let app: App;
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  setLocale("en");
  app = document.createElement("a9-zones-leave-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-zones")!;
  el.model = structuredClone(zonesModel);
  el.departmentId = "d1";
  el.zone = "z2";
  await el.updateComplete;
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function edit(el: HTMLElementTagNameMap["department-zones"]) {
  el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "counter",
          paidWhen: null,
          collectionNumber: null,
          receiptPrintMode: "on_request",
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
async function answer(value: "keep" | "discard") {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${value}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
it("switching zones asks, Keep retains and Discard permits the chosen zone event", async () => {
  const el = await mount(),
    events: unknown[] = [];
  el.addEventListener("zone-change", (e) => events.push((e as CustomEvent).detail));
  expect(unload()).toBe(false);
  await edit(el);
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=zone-z1]")!.click();
  await answer("keep");
  expect(events).toEqual([]);
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=zone-z1]")!.click();
  await answer("discard");
  expect(events).toEqual([{ zoneId: "z1" }]);
  expect(unload()).toBe(false);
});
it("a retained editor reconnects with its original dirty baseline", async () => {
  const el = await mount();
  await edit(el);
  el.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(el);
  await el.updateComplete;
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-zone]")!.click();
  await answer("keep");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-zone]")!.click();
  await answer("discard");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value.orderStart).toBe(
    null,
  );
  expect(unload()).toBe(false);
});
it("a refusal retains the dirty draft and success commits before saved observers", async () => {
  const el = await mount();
  el.api = new VenueServiceApi((async () => {
    throw null;
  }) as DashboardRequest);
  await edit(el);
  const save = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-zone]")!;
  save().click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe("The change could not be saved.");
  expect(unload()).toBe(true);
  const states: boolean[] = [];
  el.addEventListener("saved", () => states.push(unload()));
  el.api = new VenueServiceApi((async () => {}) as DashboardRequest);
  save().click();
  await expect.poll(() => states).toEqual([false]);
  expect(save().disabled).toBe(true);
});
it("a write from a disconnected editor cannot commit a later zone", async () => {
  const el = await mount();
  let finish!: () => void;
  el.api = new VenueServiceApi((() => new Promise<void>((r) => (finish = r))) as DashboardRequest);
  await edit(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-zone]")!.click();
  await el.updateComplete;
  el.remove();
  app.shadowRoot!.append(el);
  el.zone = "z1";
  await el.updateComplete;
  const events: unknown[] = [];
  el.addEventListener("saved", (e) => events.push((e as CustomEvent).detail));
  finish();
  await el.updateComplete;
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  expect(events).toEqual([]);
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Terrace");
});

it.each(["move-zone", "disable-zone"])(
  "%s asks before discarding the selected zone's service settings",
  async (action) => {
    const el = await mount();
    const events: unknown[] = [];
    el.addEventListener(action, (event) => events.push((event as CustomEvent).detail));
    await edit(el);
    const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!;
    button.click();
    await answer("keep");
    expect(events).toEqual([]);
    expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value).toEqual({
      orderStart: "counter",
      paidWhen: null,
      collectionNumber: null,
      receiptPrintMode: "on_request",
    });
    expect(unload()).toBe(true);
    button.click();
    await answer("discard");
    expect(events).toEqual([{ zoneId: "z2" }]);
    expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value).toEqual({
      orderStart: null,
      paidWhen: null,
      collectionNumber: null,
      receiptPrintMode: "on_request",
    });
    expect(unload()).toBe(false);
  },
);

it.each(["move-zone", "disable-zone"])(
  "clean %s opens without a leave question",
  async (action) => {
    const el = await mount();
    const events: unknown[] = [];
    el.addEventListener(action, (event) => events.push((event as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
    await expect.poll(() => events).toEqual([{ zoneId: "z2" }]);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
  },
);

it("Rename retains the zone service draft without asking to discard it", async () => {
  const el = await mount();
  const events: unknown[] = [];
  el.addEventListener("rename-zone", (event) => events.push((event as CustomEvent).detail));
  await edit(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-zone]")!.click();
  await expect.poll(() => events).toEqual([{ zoneId: "z2" }]);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(
    el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value.receiptPrintMode,
  ).toBe("on_request");
  expect(unload()).toBe(true);
});
