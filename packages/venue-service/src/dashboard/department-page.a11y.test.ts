import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import "./department-page.js";
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
describe.each(["light", "dark"] as const)("department-page %s", (theme) => {
  it.each(["without-transfers", "transfers", "disabled", "refusal"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<department-page></department-page>",
      theme,
    )) as HTMLElementTagNameMap["department-page"];
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
    const settings = el.shadowRoot!.querySelector("department-settings")!;
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
  it.each(["en", "es"] as const)(
    "the Opening hours warning fits a phone and is accessible in %s",
    async (locale) => {
      const previous = [window.innerWidth, window.innerHeight];
      try {
        await page.viewport(390, 1100);
        expect(window.innerWidth).toBe(390);
        setLocale(locale);
        const el = (await mountThemed(
          "<department-page></department-page>",
          theme,
        )) as HTMLElementTagNameMap["department-page"];
        host.style.width = "calc(100vw - 32px)";
        const view = structuredClone(model);
        view.departments = [view.departments[0]!];
        const name = "Restaurant".repeat(25);
        view.departments[0]!.name = name;
        view.readiness = [
          { code: "department.no_periods", departmentId: "d1", departmentName: name },
        ];
        el.model = view;
        el.departmentId = "d1";
        await el.updateComplete;
        await el.shadowRoot!.querySelector("department-settings")!.updateComplete;
        const setup = el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup]")!;
        expect(setup.textContent).toContain(
          locale === "en" ? "has no opening periods." : "no tiene períodos de apertura.",
        );
        const link = setup.querySelector<HTMLAnchorElement>("a")!;
        expect(link.getAttribute("href")).toBe("/manage/opening-hours/department/d1");
        expect(link.textContent!.trim()).toBe(
          locale === "en" ? "Set up Opening hours" : "Configura los horarios de apertura",
        );
        const bounds = el.getBoundingClientRect();
        for (const rect of [setup.getBoundingClientRect(), ...link.getClientRects()]) {
          expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
          expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
          expect(rect.width).toBeGreaterThan(0);
        }
        expect(setup.scrollWidth).toBeLessThanOrEqual(setup.clientWidth + 1);
        await expectNoA11yViolations(host);
      } finally {
        await page.viewport(previous[0]!, previous[1]!);
      }
    },
  );
});

describe.each(["light", "dark"] as const)("desktop Opening hours warning (%s)", (theme) => {
  it.each(["en", "es"] as const)(
    "the Opening hours warning fits a desktop and is accessible in %s",
    async (locale) => {
      const previous = [window.innerWidth, window.innerHeight];
      try {
        await page.viewport(1280, 1100);
        expect(window.innerWidth).toBe(1280);
        setLocale(locale);
        const el = (await mountThemed(
          "<department-page></department-page>",
          theme,
        )) as HTMLElementTagNameMap["department-page"];
        host.style.width = "calc(100vw - 32px)";
        const view = structuredClone(model);
        view.departments = [view.departments[0]!];
        const name = "Restaurant".repeat(25);
        view.departments[0]!.name = name;
        view.readiness = [
          { code: "department.no_periods", departmentId: "d1", departmentName: name },
        ];
        el.model = view;
        el.departmentId = "d1";
        await el.updateComplete;
        await el.shadowRoot!.querySelector("department-settings")!.updateComplete;
        const setup = el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup]")!;
        expect(setup.textContent).toContain(
          locale === "en" ? "has no opening periods." : "no tiene períodos de apertura.",
        );
        const link = setup.querySelector<HTMLAnchorElement>("a")!;
        expect(link.getAttribute("href")).toBe("/manage/opening-hours/department/d1");
        expect(link.textContent!.trim()).toBe(
          locale === "en" ? "Set up Opening hours" : "Configura los horarios de apertura",
        );
        const bounds = el.getBoundingClientRect();
        for (const rect of [setup.getBoundingClientRect(), ...link.getClientRects()]) {
          expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
          expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
          expect(rect.width).toBeGreaterThan(0);
        }
        expect(setup.scrollWidth).toBeLessThanOrEqual(setup.clientWidth + 1);
        await expectNoA11yViolations(host);
      } finally {
        await page.viewport(previous[0]!, previous[1]!);
      }
    },
  );
});
