import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi, type VenueDefaults } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./widgets/test-helpers.js";
import {
  receiptModel,
  preview,
  editReceipt,
  receiptSave,
  receiptRoot,
} from "./testing/department-receipt-dialog-fixture.js";
import type { DepartmentReceiptDialog } from "./screens/department-receipt-dialog.js";
import { venueDetailsFixture } from "./testing/venue-details-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", "/manage");
});
function deep(root: ShadowRoot | Element, selector: string): Element | null {
  const found = root.querySelector(selector);
  if (found) return found;
  for (const node of root.querySelectorAll("*")) {
    if (node.shadowRoot) {
      const result = deep(node.shadowRoot, selector);
      if (result) return result;
    }
  }
  return null;
}
async function mount(options: { permissions?: string[]; required?: boolean; path?: string } = {}) {
  const permissions = options.permissions ?? [
    "venue_service.manage",
    "layout.configure",
    "venue.configure",
    "venue.view",
  ];
  history.replaceState(
    null,
    "",
    options.path ?? "/manage/venue-operations/department/bar/view/receipt",
  );
  const model = {
    departments: [{ id: "bar", name: "Bar", tradingName: "Casa", active: true }],
    zones: [],
    floorZones: [],
    readiness: [],
    salePolicies: {
      departments: [
        {
          departmentId: "bar",
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: true,
        },
      ],
      zones: [],
    },
    settings: { editSentLines: true },
    kitchenTicketGrouping: "combined",
    printHeldWork: false,
    printMovedSlips: true,
    releaseReminderMinutes: null,
    clearingWorkflow: false,
  };
  const fetchImpl = vi.fn(async (path: string, init: RequestInit) => {
    if (init.method === "PUT") {
      if (path.endsWith("/bar/receipt")) {
        const input = JSON.parse(init.body as string);
        model.salePolicies.departments[0] = {
          ...model.salePolicies.departments[0]!,
          ...input.policy,
        };
      }
      return new Response(null, { status: 204 });
    }
    const answers: Record<string, unknown> = {
      "/management-api/session/me": {
        personId: "p1",
        role: "manager",
        email: null,
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Casa SL",
        permissions,
        modules: ["venue-service"],
      },
      "/management-api/locales": {
        locales: [
          { code: "en-GB", label: "English" },
          { code: "es-ES", label: "Español" },
        ],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Casa SL",
      },
      "/management-api/google/config": { configured: false },
      "/api/content-languages": { defaultLanguage: "es", languages: ["es", "ca"] },
      "/management-api/venue-service": model,
      "/management-api/venue-service/departments/bar/receipt": {
        ...receiptModel,
        venueDefaults: {},
        operationDescriptionRequired: options.required ?? true,
      },
      "/management-api/receipt-preview": preview(),
      "/management-api/receipt": { receipt: {}, venueAddress: [] },
      "/management-api/receipt-settings": { settings: {} },
      "/management-api/location-settings": { name: "Casa", operationDescription: "Legacy" },
      "/management-api/venue-details": venueDetailsFixture(),
      "/management-api/venue-defaults": {
        receiptLanguage: "es-ES",
        receiptLanguageChoices: ["es-ES"],
        fixedReceiptLanguage: null,
        defaultProductVatClass: "general",
      } satisfies VenueDefaults,
      "/management-api/alerts": { visible: false, alerts: [] },
      "/management-api/venue-service/opening-hours": {
        departments: [],
        menus: [],
        timeZone: "Europe/Madrid",
        clockReadable: true,
        dayCutover: "06:00",
        businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
        currentBusinessDay: "2026-10-12",
        clockRevision: 0,
        pending: null,
      },
    };
    return new Response(
      JSON.stringify(
        answers[path] ??
          (path.endsWith("/transfers")
            ? { departmentId: "bar", receivingProfileId: null, destinationDepartmentIds: [] }
            : []),
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  const api = new DashboardApi("", fetchImpl);
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    request: createRequest({ fetchImpl }),
  });
  await expect
    .poll(() =>
      deep(
        app.shadowRoot!,
        "venue-departments-shell, dashboard-venue-settings-screen, dashboard-overview-screen",
      ),
    )
    .toBeTruthy();
  return { app, api, fetchImpl };
}
it.each([true, false])(
  "mounts the selected protected receipt dialog with installed description visibility (%s)",
  async (required) => {
    const { app } = await mount({ required });
    await expect
      .poll(() => deep(app.shadowRoot!, "dashboard-department-receipt-dialog"))
      .toBeTruthy();
    const editor = deep(
      app.shadowRoot!,
      "dashboard-department-receipt-dialog",
    ) as DepartmentReceiptDialog;
    await expect.poll(() => receiptRoot(editor).querySelector("[name=email]")).toBeTruthy();
    expect(editor.subject).toEqual({ id: "bar", name: "Bar" });
    expect(!!receiptRoot(editor).querySelector("[name=operationDescription]")).toBe(required);
    expect(deep(app.shadowRoot!, "dashboard-receipts-screen")).toBeNull();
    expect(editor.shadowRoot!.querySelector("wt-modal")!.description).toBe("Bar");
  },
);
it("successful receipt save closes the hosted dialog and updates the department host", async () => {
  const { app, fetchImpl } = await mount();
  await expect
    .poll(() => deep(app.shadowRoot!, "dashboard-department-receipt-dialog"))
    .toBeTruthy();
  const editor = deep(
    app.shadowRoot!,
    "dashboard-department-receipt-dialog",
  ) as DepartmentReceiptDialog;
  await expect.poll(() => receiptRoot(editor).querySelector("[name=email]")).toBeTruthy();
  await editReceipt(editor, "email", "bar@example.com");
  const dialog = editor.shadowRoot!.querySelector("wt-modal")!;
  const toggle = receiptRoot(editor).querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=printTradingName]",
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  const closed = dialogClosed(dialog);
  await userEvent.click(page.elementLocator(receiptSave(editor)));
  await closed;
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations");
  expect(
    JSON.parse(
      fetchImpl.mock.calls.find(
        ([path, init]) => path.endsWith("/bar/receipt") && init.method === "PUT",
      )![1].body as string,
    ),
  ).toEqual({
    receipt: { ...receiptModel.receipt, email: "bar@example.com" },
    policy: { ...receiptModel.policy, printTradingName: false },
  });
  expect(deep(app.shadowRoot!, "dashboard-department-receipt-dialog")).toBeNull();
  const list = deep(
    app.shadowRoot!,
    "departments-list",
  ) as HTMLElementTagNameMap["departments-list"];
  await expect
    .poll(
      () =>
        list?.model?.salePolicies.departments.find((policy) => policy.departmentId === "bar")
          ?.printTradingName,
    )
    .toBe(false);
});
it("Venue settings no longer hosts a global receipt tab or global receipt reads", async () => {
  const { app, fetchImpl } = await mount({ path: "/manage/venue-settings/view/receipts" });
  await expect.poll(() => location.pathname).toBe("/manage/venue-settings/view/venue-details");
  const settings = deep(app.shadowRoot!, "dashboard-venue-settings-screen")!;
  expect(settings.shadowRoot!.querySelector("wt-tabs")!.items.map(({ key }) => key)).not.toContain(
    "receipts",
  );
  expect(deep(app.shadowRoot!, "dashboard-receipts-screen")).toBeNull();
  expect(fetchImpl.mock.calls.map(([path]) => path)).not.toEqual(
    expect.arrayContaining([
      "/management-api/receipt",
      "/management-api/receipt-settings",
      "/management-api/location-settings",
    ]),
  );
});
it("a deep link cannot open the receipt without layout permission", async () => {
  const { app, fetchImpl } = await mount({ permissions: ["venue_service.manage"] });
  expect(deep(app.shadowRoot!, "dashboard-department-receipt-dialog")).toBeNull();
  expect(fetchImpl.mock.calls.some(([path]) => path.endsWith("/bar/receipt"))).toBe(false);
});
