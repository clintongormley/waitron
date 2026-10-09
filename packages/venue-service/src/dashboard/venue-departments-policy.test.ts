import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import { VenueOperationsLoader } from "./venue-operations-loader.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import type { ServiceSettingsValue } from "./service-settings-fields.js";

customElements.define("a10-policy-loader", class extends VenueOperationsLoader {});
class PolicyApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<a10-policy-loader></a10-policy-loader>${this.leave.render({
        heading: "Unsaved changes",
        message: "Discard unsaved changes?",
        keepLabel: "Keep editing",
        discardLabel: "Discard changes",
      })}`;
  }
}
customElements.define("a10-policy-app", PolicyApp);
const initialUrl = location.href;
let app: PolicyApp;
afterEach(() => {
  app?.remove();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("en");
});

async function mount() {
  setLocale("en");
  history.replaceState(null, "", "/manage/venue-operations/department/d1");
  const stored: VenueServiceView = structuredClone(zonesModel);
  stored.departments = [stored.departments[0]!];
  stored.zones = [stored.zones[0]!, stored.zones[1]!];
  stored.salePolicies.zones = [stored.salePolicies.zones[0]!, stored.salePolicies.zones[1]!];
  stored.salePolicies.zones[0]!.orderStart = null;
  const writes: { path: string; method: string; body: unknown }[] = [];
  const api = new VenueServiceApi((async (path, method = "GET", body) => {
    if (method === "GET")
      return structuredClone(path === "/management-api/venue-service" ? stored : stored.floorZones);
    writes.push({ path, method, body: structuredClone(body) });
    if (path === "/management-api/venue-service/departments/d1/settings") {
      Object.assign(stored.salePolicies.departments[0]!, body);
    } else if (path === "/management-api/venue-service/zones/z1/service-settings") {
      Object.assign(stored.salePolicies.zones[0]!, body);
    } else throw new Error(`Unexpected write: ${method} ${path}`);
  }) as DashboardRequest);
  app = document.createElement("a10-policy-app") as PolicyApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const loader = app.shadowRoot!.querySelector("a10-policy-loader")! as VenueOperationsLoader;
  loader.api = api;
  await expect
    .poll(() => loader.shadowRoot?.querySelector("venue-departments-shell"))
    .not.toBeNull();
  const shell = loader.shadowRoot!.querySelector("venue-departments-shell")!;
  await expect.poll(() => shell.model?.departments[0]?.id).toBe("d1");
  await shell.updateComplete;
  const page = shell.shadowRoot!.querySelector("department-page")!;
  await page.updateComplete;
  const settings = page.shadowRoot!.querySelector("department-settings")!;
  await settings.updateComplete;
  return { shell, settings, writes };
}

async function pick(
  fields: HTMLElementTagNameMap["dashboard-service-settings-fields"],
  name: keyof ServiceSettingsValue,
  value: string,
) {
  await fields.updateComplete;
  const combo = fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `wt-combobox[name=${name}]`,
  );
  if (combo) {
    await combo.updateComplete;
    await userEvent.click(
      page.elementLocator(combo.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!),
    );
    await combo.updateComplete;
    const label = combo.options.find((option) => option.value === value)!.label;
    const option = [...combo.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (node) => node.textContent!.trim() === label,
    )!;
    await userEvent.click(page.elementLocator(option));
  } else {
    const control = fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
      `[name=${name}]`,
    )!;
    await control.updateComplete;
    await userEvent.click(
      page.elementLocator(control.shadowRoot!.querySelector<HTMLInputElement>("input")!),
    );
  }
}

it.each([
  ["orderStart", "counter", "Counter service", "table", "Table service"],
  ["paidWhen", "ticket_then_pay", "Paid at collection", "prepay", "Paid before preparation"],
  ["collectionNumber", "numbered", "Print", "none", "Don't print"],
  ["receiptPrintMode", "on_request", "On request", "auto", "Always"],
] as const)(
  "a saved department %s reaches a following zone, while a saved override stays explicit",
  async (field, changed, changedLabel, override, overrideLabel) => {
    const { shell, settings, writes } = await mount();
    const service = settings.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
    await pick(service, field, changed);
    await expect.poll(() => service.value[field]).toBe(changed);
    await settings.updateComplete;
    settings.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
    await expect.poll(() => shell.model.salePolicies.departments[0]![field]).toBe(changed);
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    expect(writes).toEqual([
      {
        path: "/management-api/venue-service/departments/d1/settings",
        method: "PUT",
        body: {
          name: "Restaurant",
          tradingName: "Casa",
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
          [field]: changed,
        },
      },
    ]);
    const page = shell.shadowRoot!.querySelector("department-page")!;
    await page.updateComplete;
    const tabs = page.shadowRoot!.querySelector("wt-tabs")!;
    await tabs.updateComplete;
    tabs.shadowRoot!.querySelector<HTMLElement>("[data-key=zones]")!.click();
    await shell.updateComplete;
    const zones = shell.shadowRoot!.querySelector("department-zones")!;
    await expect.poll(() => zones?.getAttribute("slot")).toBe("zones");
    await zones.updateComplete;
    const fields = zones.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
    await fields.updateComplete;
    const combo = fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `[name=${field}]`,
    )!;
    expect(combo.placeholder).toBe(changedLabel);
    expect(combo.value).toBe("");
    expect(
      zones.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-zone]")!
        .disabled,
    ).toBe(true);
    await pick(fields, field, override);
    await zones.updateComplete;
    zones.shadowRoot!.querySelector<HTMLElement>("[data-test=save-zone]")!.click();
    await expect.poll(() => shell.model.salePolicies.zones[0]![field]).toBe(override);
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    expect(writes[1]).toEqual({
      path: "/management-api/venue-service/zones/z1/service-settings",
      method: "PUT",
      body: {
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
        [field]: override,
      },
    });
    await zones.updateComplete;
    await fields.updateComplete;
    expect(combo.value).toBe(override);
    await combo.updateComplete;
    expect(combo.shadowRoot!.querySelector("button")!.textContent).toContain(overrideLabel);
    await pick(fields, field, "");
    await zones.updateComplete;
    zones.shadowRoot!.querySelector<HTMLElement>("[data-test=save-zone]")!.click();
    await expect.poll(() => shell.model.salePolicies.zones[0]![field]).toBeNull();
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    await zones.updateComplete;
    await fields.updateComplete;
    expect(writes[2]).toEqual({
      path: "/management-api/venue-service/zones/z1/service-settings",
      method: "PUT",
      body: { orderStart: null, paidWhen: null, collectionNumber: null, receiptPrintMode: null },
    });
    expect(combo.value).toBe("");
    expect(combo.placeholder).toBe(changedLabel);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(writes).toHaveLength(3);
  },
);
