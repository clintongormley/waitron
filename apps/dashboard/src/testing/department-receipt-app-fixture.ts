import { expect, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi, type VenueDefaults } from "../api/client.js";
import type { DashboardApp } from "../dashboard-app.js";
import "../dashboard-app.js";
import { mountWidget, type Theme } from "../widgets/test-helpers.js";
import { receiptModel, preview } from "./department-receipt-editor-fixture.js";
import { venueDetailsFixture } from "./venue-details-fixture.js";

export function deep(root: ShadowRoot | Element, selector: string): Element | null {
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
export async function mountReceiptApp(
  options: {
    permissions?: string[];
    required?: boolean;
    path?: string;
    locale?: string;
    theme?: Theme;
    respond?: (path: string, init: RequestInit) => Promise<Response> | undefined;
  } = {},
) {
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
    const answer = options.respond?.(path, init);
    if (answer) return answer;
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
        locale: options.locale ?? "en-GB",
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
  const { el: app, host } = await mountWidget<DashboardApp>(
    "dashboard-app",
    { api, request: createRequest({ fetchImpl }) },
    options.theme,
  );
  await expect
    .poll(() =>
      deep(
        app.shadowRoot!,
        "venue-departments-shell, dashboard-venue-settings-screen, dashboard-overview-screen",
      ),
    )
    .toBeTruthy();
  return { app, host, api, fetchImpl };
}
export async function mountReceiptTab(options: Parameters<typeof mountReceiptApp>[0] = {}) {
  const mounted = await mountReceiptApp(options);
  await expect
    .poll(() => receiptTabEditor(mounted.app)?.shadowRoot?.querySelector("[name=email]"))
    .toBeTruthy();
  const editor = receiptTabEditor(mounted.app)!;
  const modal = departmentDialog(mounted.app)!.shadowRoot!.querySelector("wt-modal")!;
  await expect.poll(() => modal.shadowRoot?.querySelector("dialog")?.matches(":modal")).toBe(true);
  return { ...mounted, editor, modal };
}
export function receiptTabEditor(app: DashboardApp) {
  return deep(app.shadowRoot!, "dashboard-department-receipt-editor") as
    HTMLElementTagNameMap["dashboard-department-receipt-editor"] | null;
}
export function departmentDialog(app: DashboardApp) {
  return deep(app.shadowRoot!, "department-edit-dialog") as
    HTMLElementTagNameMap["department-edit-dialog"] | null;
}
export function departmentForm(app: DashboardApp) {
  return deep(app.shadowRoot!, "department-settings") as
    HTMLElementTagNameMap["department-settings"] | null;
}
