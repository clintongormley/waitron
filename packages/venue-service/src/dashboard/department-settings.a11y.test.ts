import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import "./department-settings.js";
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      defaultServiceMode: "table_tab",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", defaultServiceMode: "prepay", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      defaultServiceMode: "prepay",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Terrace",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z3",
      name: "Same",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z4",
      name: "Other",
      departmentId: "d2",
      departmentName: "Deli",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
  ],
  floorZones: [],
  readiness: [],
  salePolicies: {
    departments: [
      {
        departmentId: "d1",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    ],
    zones: [
      {
        zoneId: "z1",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
        effective: {
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
      {
        zoneId: "z2",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: "on_request",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "on_request",
          printTradingName: false,
        },
      },
      {
        zoneId: "z3",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
    ],
  },
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("department-settings %s", (theme) => {
  it.each(["without-transfers", "transfers", "disabled", "refusal"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<department-settings></department-settings>",
      theme,
    )) as HTMLElementTagNameMap["department-settings"];
    const view = structuredClone(model);
    if (state === "without-transfers") view.departments[1]!.active = false;
    if (state === "disabled") view.departments[0]!.active = false;
    el.model = view;
    el.departmentId = "d1";
    el.api = new VenueServiceApi((async (path, method) => {
      if (method === "GET")
        return path.endsWith("/profiles")
          ? [{ id: "p1", name: "Restaurant counter" }]
          : { departmentId: "d1", receivingProfileId: "p1", destinationDepartmentIds: ["d2"] };
      throw {
        code: "department_transfer.settings_invalid",
        params: { field: "receivingProfileId" },
      };
    }) as DashboardRequest);
    await el.updateComplete;
    expect(el.shadowRoot).not.toBeNull();
    const settings = el;
    await settings.updateComplete;
    if (state === "transfers" || state === "refusal")
      await expect
        .poll(() => settings.shadowRoot!.querySelector("[name=receivingProfileId]"))
        .not.toBeNull();
    if (state === "refusal") {
      settings.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Revised" },
          bubbles: true,
          composed: true,
        }),
      );
      await settings.updateComplete;
      settings.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
      await expect
        .poll(
          async () =>
            (await formMessageOf(settings.shadowRoot!.querySelector("wt-form-actions")!))
              ?.textContent,
        )
        .toContain("Correct the highlighted fields");
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("Settings transfers bounds (%s)", (theme) => {
  it.each([
    ["en", 390],
    ["en", 1280],
    ["es", 390],
    ["es", 1280],
  ] as const)("desk, destinations and field refusal at %s/%i", async (locale, width) => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(width, 844);
      setLocale(locale);
      const el = (await mountThemed(
        "<department-settings></department-settings>",
        theme,
      )) as HTMLElementTagNameMap["department-settings"];
      host.style.width = "100%";
      el.model = structuredClone(model);
      el.departmentId = "d1";
      el.api = new VenueServiceApi((async (path, method) => {
        if (method === "GET")
          return path.endsWith("/profiles")
            ? [{ id: "p1", name: "Restaurant counter" }]
            : { departmentId: "d1", receivingProfileId: "p1", destinationDepartmentIds: ["d2"] };
        throw {
          code: "department_transfer.settings_invalid",
          params: { field: "receivingProfileId" },
        };
      }) as DashboardRequest);
      await el.updateComplete;
      await expect
        .poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]"))
        .not.toBeNull();
      const section = el.shadowRoot!.querySelector<HTMLElement>("[data-test=transfers-section]")!;
      const bounds = section.getBoundingClientRect();
      expect(window.innerWidth).toBe(width);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(
        section.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.checked,
      ).toBe(true);
      expect(section.querySelector("wt-combobox")!.value).toBe("p1");
      expect(section.querySelector("h2")!.textContent).toBe(
        locale === "en" ? "Tab transfers" : "Traslados de cuentas",
      );
      await expectNoA11yViolations(host);
      section.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
      await expect
        .poll(
          async () =>
            (await formMessageOf(el.shadowRoot!.querySelector("wt-form-actions")!))?.textContent,
        )
        .toContain(locale === "en" ? "Correct the highlighted fields" : "Corrige");
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
});
