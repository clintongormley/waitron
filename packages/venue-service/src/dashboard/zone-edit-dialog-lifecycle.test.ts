import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./zone-edit-dialog.js";
class App extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<zone-edit-dialog></zone-edit-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a493-zones-policy-leave-app", App);
let app: App;
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  setLocale("en");
  app = document.createElement("a493-zones-policy-leave-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("zone-edit-dialog")!;
  el.model = structuredClone(zonesModel);
  el.zoneId = "z2";
  await el.updateComplete;
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function edit(el: HTMLElementTagNameMap["zone-edit-dialog"]) {
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
it("closing asks, Keep retains the service draft and Discard emits closed", async () => {
  const el = await mount(),
    events: unknown[] = [];
  el.addEventListener("closed", (event) => events.push((event as CustomEvent).detail));
  expect(unload()).toBe(false);
  await edit(el);
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await answer("keep");
  expect(events).toEqual([]);
  expect(unload()).toBe(true);
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value.orderStart).toBe(
    "counter",
  );
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await answer("discard");
  await expect.poll(() => events).toEqual([{ zoneId: "z2" }]);
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
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await answer("keep");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
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
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
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
  // Holds every request; only the save's reply is released, so the zone's floor plan read cannot
  // take its place.
  el.api = new VenueServiceApi(
    ((_path: string, method: string) =>
      new Promise<void>((r) => {
        if (method !== "GET") finish = r;
      })) as DashboardRequest,
  );
  await edit(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await el.updateComplete;
  el.remove();
  app.shadowRoot!.append(el);
  el.zoneId = "z1";
  await el.updateComplete;
  const events: unknown[] = [];
  el.addEventListener("saved", (e) => events.push((e as CustomEvent).detail));
  finish();
  await el.updateComplete;
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  expect(events).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Terrace");
});
