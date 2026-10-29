import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  LiveData,
  type DashboardModuleContext,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
const savedCard = {
  filing: true,
  revision: "revision-1",
  timeZone: "Europe/Madrid",
  installed: null,
};
function evidence(body: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    attemptLabel: "d01cf106-38b9-4df4-9d02-f44059a6c166",
    operation: body.operation,
    source: body.source,
    binding: { sourceGeneration: body.sourceGeneration, expectedRevision: body.expectedRevision },
    environment: "preproduction",
    kind: "sello",
    endpointLabel: "preproduction-sello",
    saved: null,
    association: "unverified",
    startedAt: "2026-10-29T09:00:00.000Z",
    completedAt: "2026-10-29T09:00:01.000Z",
    durationMs: 1000,
    stage: "complete",
    category: "local-ready",
    httpStatus: null,
    localFinding: null,
    cause: "not-established",
  };
}
vi.mock("@waitron/dashboard-modules", async (original) => {
  const registry = await original<typeof import("@waitron/dashboard-modules")>();
  const real = registry.DASHBOARD_MODULES.find((module) => module.module === "fiscal-verifactu")!;
  return {
    ...registry,
    DASHBOARD_MODULES: [
      {
        module: "fiscal-verifactu",
        strings: {
          ...real.strings,
          en: { ...real.strings.en, "nav.diagnosis-test": "Certificate" },
          es: { ...real.strings.es, "nav.diagnosis-test": "Certificado" },
        },
        screen: {
          id: "diagnosis-test",
          navLabelKey: "nav.diagnosis-test",
          group: "service",
          requiresPermission: "system.manage",
          readPermission: "fiscal.view",
        },
        create: (ctx: DashboardModuleContext) => real.settingsPanels![0]!.create(ctx),
      },
    ],
  };
});
let locale = "";
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setLocale(locale);
});
const q = <T extends Element = HTMLElement>(el: Element, s: string) =>
  el.shadowRoot!.querySelector<T>(s)!;
function identity(permissions = ["fiscal.view"], personId = "operator") {
  return {
    personId,
    role: "manager" as const,
    email: "operator@example.test",
    locale: "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName: "Test venue",
    modules: ["fiscal-verifactu"],
    permissions,
    sessionExpiresInSeconds: 1800,
    sessionIdleTimeoutSeconds: 1800,
  };
}
it.each(["same-account", "other-account", "no-permission"])(
  "real shell %s sign-in resumes an empty module diagnosis and requires source reconfirmation and click",
  async (kind) => {
    let me = identity();
    const login = vi.fn(async () => ({ personId: "ignored", offerPasskey: false }));
    const request = vi.fn(async (_path: string, method: string, body?: unknown) =>
      method === "GET" ? savedCard : evidence(body as Record<string, unknown>),
    );
    const api = {
      getMe: async () => me,
      login,
      liveData: new LiveData(),
      getGoogleConfig: async () => ({ configured: false }),
      getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getLocales: async () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Test venue",
      }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      getDiskStop: async () => ({ stopped: false, deleted: null }),
    } as unknown as DashboardApi;
    history.replaceState(null, "", "/manage/diagnosis-test");
    const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: request as unknown as DashboardRequest,
    });
    await vi.waitFor(() => expect(q(app, "dashboard-aeat-certificate-card")).not.toBeNull());
    let card = q(app, "dashboard-aeat-certificate-card");
    await vi.waitFor(() => expect(q(card, "[data-test=certificate-diagnose]")).not.toBeNull());
    await userEvent.click(q(card, "[data-test=certificate-diagnose]"));
    let panel = q(card, "dashboard-aeat-certificate-diagnosis");
    await vi.waitFor(() => expect(q(panel, "[data-test=diagnosis-sign-in]")).not.toBeNull());
    await userEvent.click(q(panel, "[data-test=diagnosis-sign-in]"));
    await vi.waitFor(() => expect(q(app, "dashboard-login-screen")).not.toBeNull());
    const screen = q(app, "dashboard-login-screen");
    await vi.waitFor(() => expect(q(screen, "[name=email]")).not.toBeNull());
    const email = q<HTMLElementTagNameMap["wt-input"]>(screen, "[name=email]");
    await email.updateComplete;
    await userEvent.fill(q(email, "input"), "operator@example.test");
    await userEvent.click(q(screen, "[data-test=continue]"));
    await vi.waitFor(() => expect(q(screen, "[name=password]")).not.toBeNull());
    const password = q<HTMLElementTagNameMap["wt-input"]>(screen, "[name=password]");
    await password.updateComplete;
    await userEvent.fill(q(password, "input"), "SYNTHETIC_LOGIN_SECRET");
    me = identity(
      kind === "no-permission" ? ["fiscal.view"] : ["fiscal.view", "system.manage"],
      kind === "other-account" ? "administrator" : "operator",
    );
    await userEvent.click(q(screen, "[data-test=submit]"));
    await vi.waitFor(() => expect(q(app, "[data-test=permission-sign-in]")).toBeNull());
    await vi.waitFor(() => expect(q(app, "dashboard-aeat-certificate-card")).not.toBeNull());
    card = q(app, "dashboard-aeat-certificate-card");
    await vi.waitFor(() => expect(q(card, "dashboard-aeat-certificate-diagnosis")).not.toBeNull());
    panel = q(card, "dashboard-aeat-certificate-diagnosis");
    await (panel as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(0);
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(panel, "[data-test=diagnosis-inspect]").disabled,
    ).toBe(true);
    if (kind === "no-permission") {
      expect(q(panel, "[data-test=diagnosis-sign-in]")).not.toBeNull();
      return;
    }
    await userEvent.click(q(panel, "[data-test=diagnosis-confirm]"));
    await userEvent.click(q(panel, "[data-test=diagnosis-inspect]"));
    await vi.waitFor(() =>
      expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1),
    );
    expect(request.mock.calls.at(-1)![2]).toMatchObject({
      operation: "inspect",
      source: "installed",
    });
    expect(q<HTMLInputElement>(password, "input").value).toBe("");
  },
);
