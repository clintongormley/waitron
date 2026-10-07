import { afterEach, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { WtInput, WtTabs } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./api/client.js";
import { venueDetailsFixture } from "./testing/venue-details-fixture.js";
import { DashboardApp } from "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(
  path = "/manage/venue-settings/view/tables",
  locale = "en-GB",
  theme: "light" | "dark" = "light",
  apiOverrides: Partial<DashboardApi> = {},
) {
  history.replaceState(null, "", path);
  let logouts = 0;
  const locales: string[] = [];
  const { el: app, host } = await mountWidget<DashboardApp>(
    "dashboard-app",
    {
      api: {
        liveData: new LiveData(),
        getVenueDetails: async () => venueDetailsFixture(),
        listStatuses: async () => [
          {
            id: "s1",
            label: "Bill requested",
            color: "#ef4444",
            displayOrder: 0,
            active: true,
            createdAt: "2026-08-17T00:00:00Z",
          },
        ],
        updateStatus: async () => {},
        listStations: async () => [],
        listCoursesWithDisabled: async () => [],
        getKitchenTimingDefaults: async () => ({
          warmAfterMinutes: 5,
          overdueAfterMinutes: 10,
          forgottenAfterMinutes: 15,
        }),
        getBumpMode: async () => ({ mode: "line" }),
        getFireControl: async () => ({ mode: "waiter" }),
        getReceipt: async () => ({ receipt: {}, venueAddress: [] }),
        getLocationSettings: async () => ({ name: "Venue", operationDescription: "Sale" }),
        getReceiptLanguage: async () => ({ language: "es-ES", choices: ["es-ES"], fixed: null }),
        getVenueDepartments: async () => [],
        getMe: async () => ({
          personId: "p1",
          email: "ada@example.com",
          role: "manager",
          locale,
          venueLocale: locale,
          sessionDefault: locale,
          venueName: "Venue",
          permissions: ["venue.view", "venue.configure"],
          modules: [],
        }),
        getLocales: async () => ({
          locales: [
            { code: "en-GB", label: "English" },
            { code: "es-ES", label: "Español" },
          ],
          venueDefault: "en-GB",
          loginDefault: "en-GB",
          venueName: "Venue",
          onboardingIntent: "prepare",
        }),
        getGoogleConfig: async () => ({ configured: false }),
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        getStaffRoster: async () => [{ personId: "p1", displayName: "Ada" }],
        listMyShifts: async () => [],
        listMySwaps: async () => [],
        listMyAbsences: async () => [],
        listOrderStaff: async () => ({ staff: [] }),
        listOrderPages: async () => ({ rows: [], next: null, from: null, to: null }),
        listAlerts: async () => ({ visible: false, alerts: [] }),
        passkeySignals: async () => ({
          rpId: "localhost",
          userId: "cDE",
          credentialIds: [],
          name: "ada@example.com",
          displayName: "Ada",
        }),
        logout: async () => {
          logouts++;
        },
        putLocale: async (code: string) => {
          locales.push(code);
        },
        ...apiOverrides,
      } as unknown as DashboardApi,
    },
    theme,
  );
  await expect
    .poll(() =>
      app
        .shadowRoot!.querySelector("dashboard-venue-settings-screen")
        ?.shadowRoot?.querySelector("dashboard-service-status-screen")
        ?.shadowRoot?.querySelector("[data-test=label-s1]"),
    )
    .toBeTruthy();
  return { app, host, logouts: () => logouts, locales };
}

async function editTiming(app: DashboardApp) {
  const kitchen = settings(app).shadowRoot!.querySelector("dashboard-kitchen-screen")!;
  await expect
    .poll(() => kitchen.shadowRoot?.querySelector("[data-test=edit-timing]"))
    .toBeTruthy();
  kitchen.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-timing]")!.click();
  await kitchen.updateComplete;
  const input = kitchen.shadowRoot!.querySelector<WtInput>("[name=warmAfterMinutes]")!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), "6");
  return { kitchen, input };
}

it("the actual Kitchen tab keeps late flags through Keep and restores them only after Discard", async () => {
  const { app } = await mount("/manage/venue-settings/view/kitchen");
  const { input } = await editTiming(app);
  await select(app, "tables");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  expect(selected(app)).toBe("kitchen");
  expect(input.checkVisibility()).toBe(true);
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
  await choose(app, "keep");
  expect(input.value).toBe("6");
  await select(app, "tables");
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  expect(input.value).toBe("5");
  expect(input.checkVisibility()).toBe(false);
});

it("real history Back waits for a Kitchen timing decision and Forward restores its accepted baseline", async () => {
  const { app } = await mount();
  await select(app, "kitchen");
  const { input } = await editTiming(app);
  history.back();
  await choose(app, "keep");
  expect(selected(app)).toBe("kitchen");
  expect(input.value).toBe("6");
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  history.forward();
  await expect.poll(() => selected(app)).toBe("kitchen");
  expect(input.value).toBe("5");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it("Kitchen timing protects sidebar, voluntary logout and language replacement before their actions", async () => {
  const { app, logouts, locales } = await mount("/manage/venue-settings/view/kitchen");
  const { input } = await editTiming(app);
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
  expect(input.value).toBe("6");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
  await choose(app, "keep");
  expect(logouts()).toBe(0);
  app.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
    new CustomEvent("wt-locale-selected", {
      detail: { code: "es-ES" },
      bubbles: true,
      composed: true,
    }),
  );
  await choose(app, "keep");
  expect(locales).toEqual([]);
  expect(input.value).toBe("6");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(input.isConnected).toBe(false);
});

it("forced expiry clears a Kitchen timing draft and makes its unanswered Discard inert", async () => {
  const { app, logouts } = await mount("/manage/venue-settings/view/kitchen");
  const { kitchen, input } = await editTiming(app);
  await select(app, "tables");
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  const discard = warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await expect.poll(() => kitchen.isConnected).toBe(false);
  discard.click();
  expect(logouts()).toBe(0);
  expect(input.isConnected).toBe(false);
  expect(location.pathname).toBe("/manage/");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});

function settings(app: DashboardApp) {
  return app.shadowRoot!.querySelector("dashboard-venue-settings-screen")!;
}
function tabs(app: DashboardApp) {
  return settings(app).shadowRoot!.querySelector<WtTabs>("wt-tabs")!;
}
function status(app: DashboardApp) {
  return settings(app).shadowRoot!.querySelector("dashboard-service-status-screen")!;
}
function field(app: DashboardApp) {
  return status(app).shadowRoot!.querySelector<WtInput>("[data-test=label-s1]")!;
}
function selected(app: DashboardApp) {
  return tabs(app)
    .shadowRoot!.querySelector("[role=tab][aria-selected=true]")
    ?.getAttribute("data-key");
}
async function edit(app: DashboardApp, value = "Please bring the bill") {
  await field(app).updateComplete;
  await userEvent.fill(page.elementLocator(field(app).shadowRoot!.querySelector("input")!), value);
  await status(app).updateComplete;
}
async function select(app: DashboardApp, key: string) {
  await userEvent.click(
    page.elementLocator(tabs(app).shadowRoot!.querySelector(`[role=tab][data-key=${key}]`)!),
  );
}
async function choose(app: DashboardApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  await userEvent.click(
    page.elementLocator(question.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
  );
  await expect.poll(() => question.open).toBe(false);
}

it("keeps the actual Tables panel visible while a tab leave is unanswered or kept", async () => {
  const { app } = await mount();
  await edit(app);
  await select(app, "kitchen");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  expect(selected(app)).toBe("tables");
  expect(field(app).checkVisibility()).toBe(true);
  expect(location.pathname).toBe("/manage/venue-settings/view/tables");
  await choose(app, "keep");
  expect(selected(app)).toBe("tables");
  expect(field(app).checkVisibility()).toBe(true);
  expect(field(app).value).toBe("Please bring the bill");
  await select(app, "kitchen");
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("kitchen");
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
  expect(field(app).value).toBe("Bill requested");
  expect(field(app).checkVisibility()).toBe(false);
});

it("ignores repeated tab targets while deciding and changes only to the accepted target", async () => {
  const { app } = await mount();
  await edit(app);
  await select(app, "kitchen");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  tabs(app).shadowRoot!.querySelector<HTMLButtonElement>("[data-key=receipts]")!.click();
  await tabs(app).updateComplete;
  expect(selected(app)).toBe("tables");
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("kitchen");
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
});

it("a reverted status lets the real container tab switch without warning", async () => {
  const { app } = await mount();
  await edit(app);
  await edit(app, "Bill requested");
  await select(app, "kitchen");
  await expect.poll(() => selected(app)).toBe("kitchen");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
});

it("a real Venue details draft stays visible through its container tab warning", async () => {
  const { app } = await mount("/manage/venue-settings/view/venue-details");
  const panel = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
  await panel.updateComplete;
  const street = panel.shadowRoot!.querySelector<WtInput>("[name=addressLine1]")!;
  await street.updateComplete;
  await userEvent.fill(
    page.elementLocator(street.shadowRoot!.querySelector("input")!),
    "Different street",
  );
  await select(app, "tables");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  expect(selected(app)).toBe("venue-details");
  expect(street.checkVisibility()).toBe(true);
  await choose(app, "keep");
  expect(street.value).toBe("Different street");
  expect(selected(app)).toBe("venue-details");
  await select(app, "tables");
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  expect(street.value).toBe("Calle Mayor 1");
});

it("keyboard tab navigation holds the edited panel until Discard", async () => {
  const { app } = await mount();
  await edit(app);
  tabs(app).shadowRoot!.querySelector<HTMLButtonElement>("[data-key=tables]")!.focus();
  await userEvent.keyboard("{End}");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  expect(selected(app)).toBe("tables");
  expect(field(app).checkVisibility()).toBe(true);
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("kitchen");
});

it("real Back and Forward retain edited Tables until the requested traversal is accepted", async () => {
  const { app } = await mount("/manage/venue-settings/view/kitchen");
  await select(app, "tables");
  await edit(app);
  history.back();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/venue-settings/view/tables");
  expect(selected(app)).toBe("tables");
  expect(field(app).value).toBe("Please bring the bill");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("kitchen");
  history.forward();
  await expect.poll(() => selected(app)).toBe("tables");
  expect(field(app).value).toBe("Bill requested");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it("sidebar and voluntary sign-out consult the actual retained status draft", async () => {
  const { app, logouts } = await mount();
  await edit(app);
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/venue-settings/view/tables");
  expect(field(app).value).toBe("Please bring the bill");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
  await choose(app, "keep");
  expect(logouts()).toBe(0);
  expect(field(app).value).toBe("Please bring the bill");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(app.shadowRoot!.querySelector("dashboard-venue-settings-screen")).toBeNull();
});

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`renders the real Venue details tab warning in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        expect(window.innerWidth).toBe(width);
        const { app, host } = await mount(
          "/manage/venue-settings/view/venue-details",
          locale,
          theme,
        );
        expect(host.dataset.theme).toBe(theme);
        const panel = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
        await expect.poll(() => panel.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
        panel.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
        await panel.updateComplete;
        const street = panel.shadowRoot!.querySelector<WtInput>("[name=addressLine1]")!;
        await street.updateComplete;
        await userEvent.fill(
          page.elementLocator(street.shadowRoot!.querySelector("input")!),
          "Different street",
        );
        await select(app, "tables");
        const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
        await expect.poll(() => warning.open).toBe(true);
        expect(selected(app)).toBe("venue-details");
        await warning.updateComplete;
        await commands.parkPointer();
        await expectNoA11yViolations(warning);
        await page.screenshot({ path: `w69-venue-look/${locale}-${theme}-${width}-warning.png` });
        await choose(app, "keep");
        expect(street.value).toBe("Different street");
        expect(street.checkVisibility()).toBe(true);
        await page.screenshot({ path: `w69-venue-look/${locale}-${theme}-${width}-kept.png` });
        await select(app, "tables");
        await choose(app, "discard");
        await expect.poll(() => selected(app)).toBe("tables");
      });
    }
  }
}

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`receipt preview department navigation retains edited appearance in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        const previews: { heading: string | undefined; department: string | undefined }[] = [];
        const { app } = await mount("/manage/venue-settings/view/receipts", locale, theme, {
          getVenueDepartments: async () => [
            { id: "bar", name: "Bar", active: true },
            { id: "deli", name: "Deli", active: true },
          ],
          previewReceipt: async (config, _width, _language, department) => {
            previews.push({ heading: config.headerSubtitle, department });
            return {
              preview: {
                widthDots: 512,
                columns: 42,
                text: "Venue",
                blocks: [{ kind: "text", text: "Venue" }],
                qrData: [],
                omittedGraphics: false,
                truncated: false,
                unsupported: false,
              },
              marks: {
                headerSubtitle: null,
                footerMessage: null,
                phone: null,
                email: null,
                address: null,
                logo: null,
              },
              paperWidth: "80mm",
              paperWidths: ["80mm"],
            };
          },
        });
        const receipt = settings(app).shadowRoot!.querySelector("dashboard-receipts-screen")!;
        await expect
          .poll(() => new URL(location.href).searchParams.get("departmentId"))
          .toBe("bar");
        const input = receipt.shadowRoot!.querySelector<WtInput>("[name=headerSubtitle]")!;
        await input.updateComplete;
        await userEvent.fill(input.shadowRoot!.querySelector("input")!, "Edited heading");
        const preview = receipt.shadowRoot!.querySelector("[name=previewDepartment]")!;
        preview.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "deli" } }));
        await expect
          .poll(() => new URL(location.href).searchParams.get("departmentId"))
          .toBe("deli");
        expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
        expect(input.value).toBe("Edited heading");
        await expect
          .poll(() => previews.at(-1))
          .toEqual({ heading: "Edited heading", department: "deli" });
        history.back();
        await expect
          .poll(() => new URL(location.href).searchParams.get("departmentId"))
          .toBe("bar");
        expect(input.value).toBe("Edited heading");
        expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await expect
          .poll(() => previews.at(-1))
          .toEqual({ heading: "Edited heading", department: "bar" });
        await select(app, "kitchen");
        const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
        await expect.poll(() => warning.open).toBe(true);
        await warning.updateComplete;
        await commands.parkPointer();
        await expectNoA11yViolations(warning);
        await page.screenshot({
          path: `../node_modules/.cache/w69-receipt-look/${locale}-${theme}-${width}-warning.png`,
        });
        await choose(app, "keep");
        expect(selected(app)).toBe("receipts");
        expect(input.value).toBe("Edited heading");
        await input.updateComplete;
        await userEvent.click(input.shadowRoot!.querySelector("input")!);
        await page.screenshot({
          path: `../node_modules/.cache/w69-receipt-look/${locale}-${theme}-${width}-kept.png`,
        });
        await select(app, "kitchen");
        await choose(app, "discard");
        await expect.poll(() => selected(app)).toBe("kitchen");
        expect(input.value).toBe("");
      });
    }
  }
}

it("the real Receipts department-management link protects the appearance before leaving", async () => {
  const { app } = await mount("/manage/venue-settings/view/receipts");
  const receipt = settings(app).shadowRoot!.querySelector("dashboard-receipts-screen")!;
  const input = receipt.shadowRoot!.querySelector<WtInput>("[name=headerSubtitle]")!;
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector("input")!, "Edited heading");
  const link = receipt.shadowRoot!.querySelector<HTMLAnchorElement>(
    'a[href="/manage/venue-operations"]',
  )!;
  await userEvent.click(link);
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  expect(input.value).toBe("Edited heading");
  await userEvent.click(link);
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(input.value).toBe("");
  expect(receipt.isConnected).toBe(false);
});
