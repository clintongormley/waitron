import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtReportDialog, WtTextarea } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { TrailEvent } from "@waitron/diagnostics";
import { DashboardApi } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import type { DashboardProblemReport } from "./problem-report.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { diag } from "./diagnostics.js";
import { setLocale } from "./i18n/t.js";
import { chooseTheme } from "@waitron/ui";
import "./dashboard-app.js";

const initialUrl = location.href;
const navRows = (trail: TrailEvent[]) => trail.filter((row) => row.event === "nav");

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  vi.unstubAllGlobals();
  setLocale("en-GB");
});
async function fixture(api?: DashboardApi) {
  vi.stubGlobal("isSecureContext", true);
  setLocale("en-GB");
  const { el } = await mountWidget<DashboardProblemReport>("dashboard-problem-report", { api });
  const trigger = el.shadowRoot?.querySelector<WtButton>("[data-report-problem]");
  expect(trigger).toBeDefined();
  await userEvent.click(trigger!);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
  await dialog.updateComplete;
  return { el, dialog, trigger: trigger! };
}
function preview(dialog: WtReportDialog) {
  return dialog.shadowRoot!.querySelector("pre")!.textContent!;
}
async function describeProblem(dialog: WtReportDialog, value: string) {
  const field = dialog.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("textarea")!;
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  await dialog.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dialog.updateComplete;
}
function data(text: string) {
  return JSON.parse(text.split("```json\n")[1]!.split("\n```")[0]!);
}

it("hides the reporting entry when the browser has no secure context", async () => {
  vi.stubGlobal("isSecureContext", false);
  const { el } = await mountWidget<HTMLElement & { updateComplete: Promise<boolean> }>(
    "dashboard-problem-report",
    {},
  );
  expect(el.shadowRoot!.querySelector("[data-report-problem]")).toBeNull();
});

it("renders an icon-only 44px entry with a tooltip and accessible name", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<HTMLElement & { updateComplete: Promise<boolean> }>(
    "dashboard-problem-report",
    {},
  );
  const trigger = el.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!;
  await trigger.updateComplete;
  await expect
    .element(trigger.shadowRoot!.querySelector("button")!)
    .toHaveAccessibleName("Report a problem");
  expect(trigger.title).toBe("Report a problem");
  const icon = trigger.querySelector("wt-icon")!;
  expect(trigger.textContent?.trim()).toBe("");
  expect(icon.getBoundingClientRect().width).toBe(18);
  expect(trigger.getBoundingClientRect().height).toBe(44);
  expect(trigger.getBoundingClientRect().width).toBe(44);
});

it.each([
  ["signed-out boot and failed recheck", "/overview", "refused", ["login"]],
  ["already signed in with a background recheck", "/", "recheck", ["my-schedule"]],
  ["direct zone repair", "/overview", "zone", ["zone-repair"]],
  [
    "account-action link",
    "/account?token=private-account-token&purpose=invitation",
    "account",
    ["login"],
  ],
  ["same-address sign-in", "/overview", "sign-in", ["login", "overview"]],
  ["canonical redirect after sign-in", "/", "sign-in", ["login", "overview"]],
  ["legacy redirect after sign-in", "/printing-rules", "sign-in", ["login", "prep-stations"]],
] as const)(
  "shows the navigation trail in the real dashboard banner report for %s",
  async (_name, path, session, screens) => {
    const before = navRows(diag.snapshot()).length;
    const signedIn = session === "recheck" || session === "zone";
    const signIn = session === "sign-in";
    const prepStations = path === "/printing-rules";
    vi.stubGlobal("isSecureContext", true);
    history.replaceState(null, "", path);
    vi.stubGlobal(
      "PublicKeyCredential",
      class {
        static isConditionalMediationAvailable = async () => false;
      },
    );
    let authenticated: boolean = signedIn;
    const getMe = vi.fn(async () => {
      if (!authenticated) throw { code: "management_session.required" };
      return {
        personId: "00000000-0000-4000-8000-000000000001",
        email: "ada@example.test",
        roleIds: ["manager"],
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        permissions: prepStations
          ? ["venue.view", "venue.configure"]
          : signIn
            ? ["venue.view"]
            : [],
        modules: prepStations ? ["venue-service"] : [],
        tradingAdmission: { state: session === "zone" ? "invalid" : "ready" },
        venueName: "Report fixture",
      };
    });
    const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
      api: {
        liveData: new LiveData(),
        getMe,
        request: async (route: string) => {
          expect(route).toBe("/management-api/venue-service/routing");
          return {
            stationTimes: [],
            todayEnds: null,
            clockReadable: true,
            zones: [],
            categories: [],
            products: [],
            periods: [],
            cells: [],
            defaultStationId: null,
            stations: [],
            canMakeDefault: false,
          };
        },
        inspectAccountAction: async () => ({ email: "ada@example.test", purpose: "invitation" }),
        forgetLocales: () => {},
        getLocales: async () => ({
          locales: [{ code: "en-GB", label: "English" }],
          venueDefault: "en-GB",
          loginDefault: "en-GB",
          venueName: "Report fixture",
          onboardingIntent: "prepare",
        }),
        getGoogleConfig: async () => ({ configured: false }),
        getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
        getLegalAbout: async () => ({ release: null, build: "test" }),
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        listAlerts: async () => ({ visible: false, alerts: [] }),
        getDiskStop: async () => ({ stopped: false, deleted: null }),
        passkeySignals: async () => ({
          rpId: "localhost",
          userId: "YWRh",
          credentialIds: [],
          name: "ada@example.test",
          displayName: "Ada",
        }),
      } as unknown as DashboardApi,
    });
    await expect
      .poll(() =>
        app.shadowRoot!.querySelector(
          session === "zone"
            ? "dashboard-venue-zone-repair"
            : signedIn
              ? "[data-test=account-menu]"
              : "dashboard-login-screen",
        ),
      )
      .not.toBeNull();
    if (session === "recheck") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await expect.poll(() => getMe.mock.calls.length).toBe(2);
      await getMe.mock.results[1]!.value;
    } else if (!signedIn) {
      const login = app.shadowRoot!.querySelector("dashboard-login-screen")!;
      await expect.poll(() => login.checkingSession).toBe(false);
      if (session !== "account") {
        const replace = vi.spyOn(history, "replaceState");
        const push = vi.spyOn(history, "pushState");
        authenticated = signIn;
        login.dispatchEvent(new CustomEvent("logged-in", { bubbles: true, composed: true }));
        await expect.poll(() => getMe.mock.calls.length).toBe(2);
        await getMe.mock.results[1]!.value.catch(() => undefined);
        if (signIn) {
          const destination = prepStations ? "prep-stations" : "overview";
          await expect
            .poll(() => app.shadowRoot!.querySelector(`dashboard-${destination}-screen`))
            .not.toBeNull();
          expect(location.pathname).toBe(
            prepStations ? "/prep-stations/view/stations" : "/overview",
          );
        }
        if (path === "/overview") {
          expect(replace).not.toHaveBeenCalled();
          expect(push).not.toHaveBeenCalled();
        }
      } else {
        expect(getMe).not.toHaveBeenCalled();
      }
    }
    const report = app.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-problem-report"]>(
      "[data-test=brand-banner] dashboard-problem-report",
    )!;
    expect(report).not.toBeNull();
    await report.updateComplete;
    const trigger = report.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!;
    await trigger.updateComplete;
    await userEvent.click(trigger.shadowRoot!.querySelector("button")!);
    await report.updateComplete;
    const dialog = report.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
    await dialog.updateComplete;
    expect(dialog.open).toBe(true);
    const snapshot = data(preview(dialog));
    expect(snapshot.app).toBe("dashboard");
    expect(
      navRows(snapshot.trail)
        .slice(before)
        .map(({ fields }) => fields),
    ).toEqual(screens.map((screen) => ({ screen })));
    expect(JSON.stringify(snapshot)).not.toContain("private-account-token");
  },
);

it("freezes the opening activity and facts while description edits update the preview", async () => {
  diag.record("info", "api", {
    phase: "end",
    method: "GET",
    path: "/management-api/session/me",
    status: 200,
  });
  const { dialog } = await fixture();
  const opened = data(preview(dialog));
  diag.record("info", "api", {
    phase: "end",
    method: "DELETE",
    path: "/later-private-route",
    status: 403,
  });
  await describeProblem(dialog, "The bill is hard to read.");
  const edited = data(preview(dialog));
  expect(edited.description).toBe("The bill is hard to read.");
  expect({
    id: edited.id,
    openedAt: edited.openedAt,
    trail: edited.trail,
    client: edited.client,
  }).toEqual({
    id: opened.id,
    openedAt: opened.openedAt,
    trail: opened.trail,
    client: opened.client,
  });
  expect(
    edited.trail.some((row: { fields: { method?: string } }) => row.fields.method === "DELETE"),
  ).toBe(false);
});

it("downloads exactly the visible file, releases its URL and makes no network or storage write", async () => {
  const { dialog } = await fixture();
  await describeProblem(dialog, "The bill is hard to read.");
  const visible = preview(dialog),
    urls: string[] = [],
    blobs: Blob[] = [];
  const realURL = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    const url = realURL(blob);
    urls.push(url);
    return url;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const files: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    files.push(this.download);
  });
  const fetch = vi.fn(() => {
    throw new Error("Reporting must not use the network");
  });
  vi.stubGlobal("fetch", fetch);
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const button = dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!;
  await userEvent.click(button);
  expect(await blobs[0]!.text()).toBe(visible);
  expect(files).toEqual([`problem-report-${data(visible).id}.md`]);
  expect(revoke).toHaveBeenCalledWith(urls[0]);
  expect(document.querySelector(`a[href="${urls[0]}"]`)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
});

it("retains the editable description after a failed download and retries without a new snapshot", async () => {
  const { dialog } = await fixture();
  await describeProblem(dialog, "The bill is hard to read.");
  const visible = preview(dialog),
    realURL = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL")
    .mockImplementationOnce(() => {
      throw new Error("Download refused");
    })
    .mockImplementation(realURL);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const button = dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!;
  await userEvent.click(button);
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  expect(dialog.description).toBe("The bill is hard to read.");
  expect(dialog.downloadError).not.toBe("");
  expect(button.disabled).toBe(false);
  expect(preview(dialog)).toBe(visible);
  await userEvent.click(button);
  await expect.poll(() => dialog.open).toBe(false);
});

it.each([
  ["", undefined, undefined, "Sent to Waitron Cloud."],
  [
    "Private staff note",
    "waiting",
    undefined,
    "Sent to Waitron Cloud. Your description is waiting for a manager to send it.",
  ],
  ["Printer jammed", "queued", true, "Sent to Waitron Cloud. Your description is queued to send."],
] as const)(
  "sends the Cloud attachment with the requested description handling (%s)",
  async (text, result, admin, status) => {
    const urls: string[] = [];
    const api = new DashboardApi("", async (url, init) => {
      urls.push(`${init.method} ${url}`);
      if (init.method === "GET")
        return Response.json({
          available: true,
          id: "preview",
          attachment: '{"version":"1.2.3"}',
          admin,
        });
      expect(init.body).toBe(text ? JSON.stringify({ description: text }) : undefined);
      return Response.json({ delivery: "sent", description: result });
    });
    const { dialog } = await fixture(api);
    if (text) await describeProblem(dialog, text);
    await expect
      .poll(() => dialog.shadowRoot!.querySelector("[data-cloud-preview]")?.textContent)
      .toBe('{"version":"1.2.3"}');
    await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-send]")!);
    await expect
      .poll(() => dialog.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim())
      .toBe(status);
    expect(urls).toEqual([
      "GET /management-api/problem-reports/preview",
      "POST /management-api/problem-reports/preview/send",
    ]);
  },
);

const canDownload = "Could not send the report. Download it to keep a copy.";
it.each([
  ["", "cloud.busy", canDownload],
  ["Printer jammed", "cloud.not_configured", canDownload],
  [
    "Printer jammed",
    "cloud.busy",
    "Could not send the report. Clear the description to try sending just the diagnostics, or download a copy.",
  ],
] as const)("recovery for %s and %s", async (description, code, message) => {
  const api = new DashboardApi("", async (_, init) =>
    init.method === "GET"
      ? Response.json({ available: true, id: "preview", attachment: '{"version":"1.2.3"}' })
      : Response.json({ error: { code, params: {} } }, { status: 409 }),
  );
  const { dialog } = await fixture(api);
  await expect.poll(() => dialog.shadowRoot!.querySelector("[data-send]")).not.toBeNull();
  if (description) await describeProblem(dialog, description);
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-send]")!);
  await expect.poll(() => dialog.shadowRoot!.querySelector("wt-form-actions")?.error).toBe(message);
  expect(dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!.disabled).toBe(false);
});

it.each([
  ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "firefox"],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    "safari",
  ],
  ["Mozilla/5.0 (compatible; Kiosk/1.0)", "other"],
  [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "chromium",
  ],
] as const)("names the browser in the report from its user agent %#", async (agent, browser) => {
  vi.spyOn(Navigator.prototype, "userAgent", "get").mockReturnValue(agent);
  const { dialog } = await fixture();
  expect(data(preview(dialog)).client.browser).toBe(browser);
});

it("reports a Spanish dashboard's language as Spanish", async () => {
  vi.stubGlobal("isSecureContext", true);
  setLocale("es-ES");
  const { el } = await mountWidget<DashboardProblemReport>("dashboard-problem-report", {});
  await userEvent.click(el.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
  await dialog.updateComplete;
  expect(data(preview(dialog)).client.locale).toBe("es");
});

it("reports the chosen theme, and the device's dark preference when the device decides", async () => {
  try {
    chooseTheme("dark");
    const chosen = await fixture();
    expect(data(preview(chosen.dialog)).client.theme).toBe("dark");
    cleanupWidgets();
    chooseTheme("device");
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" }) as MediaQueryList,
    );
    const device = await fixture();
    expect(data(preview(device.dialog)).client.theme).toBe("dark");
  } finally {
    vi.restoreAllMocks();
    chooseTheme("device");
  }
});

it("keeps the open report and its description when a script clicks the entry behind the open dialog", async () => {
  const { dialog, trigger } = await fixture();
  await describeProblem(dialog, "The bill is hard to read.");
  const opened = data(preview(dialog));
  trigger.click();
  await dialog.updateComplete;
  expect(dialog.description).toBe("The bill is hard to read.");
  expect(data(preview(dialog)).id).toBe(opened.id);
});

it("downloads nothing for a scripted download request while the description is not valid, which the dialog never sends", async () => {
  const { dialog } = await fixture();
  await describeProblem(dialog, "Bell \u0007 rang");
  expect(dialog.validationError).not.toBe("");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createUrl = vi.spyOn(URL, "createObjectURL");
  dialog.dispatchEvent(
    new CustomEvent("wt-report-download", {
      detail: { description: "Bell \u0007 rang", preview: preview(dialog) },
      bubbles: true,
      composed: true,
    }),
  );
  await dialog.updateComplete;
  expect(createUrl).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  expect(dialog.open).toBe(true);
});
