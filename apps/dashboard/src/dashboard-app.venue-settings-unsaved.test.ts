import { afterEach, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import {
  leaveCoordinatorFor,
  registerIcons,
  type WtFormActions,
  type WtInput,
  type WtTabs,
} from "@waitron/ui";
import { DASHBOARD_ICONS } from "./icons.js";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, VenueDefaults } from "./api/client.js";
import { venueDetailsFixture } from "./testing/venue-details-fixture.js";
import { DashboardApp } from "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import { receiptLanguageName } from "./widgets/receipt-language.js";
import {
  mountReceiptEditor,
  receiptApi,
  receiptField,
  editReceipt,
  preview,
  receiptRoot,
} from "./testing/department-receipt-editor-fixture.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import { departmentDialog, mountReceiptTab } from "./testing/department-receipt-app-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(
  path = "/manage/venue-settings/view/tables",
  locale = "en-GB",
  theme: "light" | "dark" = "light",
  apiOverrides: Partial<DashboardApi> = {},
  permissions = ["venue.view", "venue.configure"],
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
        listCourses: async () => [],
        getKitchenTimingDefaults: async () => ({
          warmAfterMinutes: 5,
          overdueAfterMinutes: 10,
          forgottenAfterMinutes: 15,
        }),
        getBumpMode: async () => ({ mode: "line" }),
        getFireControl: async () => ({ mode: "waiter" }),
        getDepartmentReceipt: async () => ({
          receipt: {},
          venueDefaults: {},
          languages: ["es-ES"],
          warningLanguages: [],
          venueAddress: [],
        }),
        getReceiptLanguage: async () => ({ language: "es-ES", choices: ["es-ES"], fixed: null }),
        getVenueDefaults: async () => ({
          receiptLanguage: "es-ES",
          receiptLanguageChoices: ["es-ES"],
          fixedReceiptLanguage: null,
          defaultProductVatClass: "general",
        }),
        getVenueDepartments: async () => [],
        getMe: async () => ({
          personId: "p1",
          email: "ada@example.com",
          role: "manager",
          locale,
          venueLocale: locale,
          sessionDefault: locale,
          venueName: "Venue",
          permissions,
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
  if (!permissions.includes("venue.configure")) {
    await expect
      .poll(() => app.shadowRoot!.querySelector("dashboard-venue-settings-screen"))
      .toBeTruthy();
    return { app, host, logouts: () => logouts, locales };
  }
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
  tabs(app).shadowRoot!.querySelector<HTMLButtonElement>("[data-key=venue-details]")!.click();
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
  await panel.updateComplete;
  expect(street.isConnected).toBe(false);
  expect(panel.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(
    panel.shadowRoot!.querySelector("[data-test=saved-addressLine1]")!.textContent!.trim(),
  ).toBe("Calle Mayor 1");
});

async function editVenueDetails(app: DashboardApp) {
  const panel = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
  await panel.updateComplete;
  const street = panel.shadowRoot!.querySelector<WtInput>("[name=addressLine1]")!;
  await street.updateComplete;
  return { panel, street };
}
function inViewMode(panel: HTMLElementTagNameMap["dashboard-venue-details-panel"]) {
  return (
    panel.shadowRoot!.querySelector("[data-test=edit]") !== null &&
    panel.shadowRoot!.querySelector("wt-input") === null
  );
}

it("a Venue details edit with nothing changed ends when its tab is left", async () => {
  const { app } = await mount("/manage/venue-settings/view/venue-details");
  const { panel } = await editVenueDetails(app);
  await select(app, "tables");
  await expect.poll(() => selected(app)).toBe("tables");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  await select(app, "venue-details");
  await expect.poll(() => selected(app)).toBe("venue-details");
  expect(inViewMode(panel)).toBe(true);
});

it("a changed Venue details edit survives Keep and ends in view mode after Discard", async () => {
  const { app } = await mount("/manage/venue-settings/view/venue-details");
  const { panel, street } = await editVenueDetails(app);
  await userEvent.fill(
    page.elementLocator(street.shadowRoot!.querySelector("input")!),
    "Different street",
  );
  await select(app, "tables");
  await choose(app, "keep");
  expect(selected(app)).toBe("venue-details");
  expect(inViewMode(panel)).toBe(false);
  expect(panel.shadowRoot!.querySelector<WtInput>("[name=addressLine1]")!.value).toBe(
    "Different street",
  );
  await select(app, "tables");
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  await select(app, "venue-details");
  await expect.poll(() => selected(app)).toBe("venue-details");
  await panel.updateComplete;
  expect(inViewMode(panel)).toBe(true);
  expect(
    panel.shadowRoot!.querySelector("[data-test=saved-addressLine1]")!.textContent!.trim(),
  ).toBe("Calle Mayor 1");
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
        await page.screenshot({
          path: `node_modules/.cache/w69-venue-look/${locale}-${theme}-${width}-warning.png`,
        });
        await choose(app, "keep");
        expect(street.value).toBe("Different street");
        expect(street.checkVisibility()).toBe(true);
        await page.screenshot({
          path: `node_modules/.cache/w69-venue-look/${locale}-${theme}-${width}-kept.png`,
        });
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
      it(`department receipt preview retains edited appearance in ${locale}/${theme}/${width}`, async () => {
        const viewport = { width: innerWidth, height: innerHeight };
        await page.viewport(width, 900);
        setLocale(locale);
        registerIcons(DASHBOARD_ICONS);
        try {
          const api = receiptApi();
          api.previewReceiptDraft.mockImplementation(async (draft) =>
            preview(draft.receipt.headerSubtitle?.["es-ES"] ?? "Bar"),
          );
          const { app, host, el } = await mountReceiptEditor(api, theme);
          const input = receiptField(el, "headerSubtitle-es-ES");
          await editReceipt(el, "headerSubtitle-es-ES", "Edited heading");
          expect(input.value).toBe("Edited heading");
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          await expect
            .poll(() => api.previewReceiptDraft.mock.lastCall?.[0])
            .toMatchObject({
              departmentId: "bar",
              receipt: { headerSubtitle: { "es-ES": "Edited heading" } },
            });
          await expect
            .poll(() => receiptRoot(el).querySelector(".paper")?.textContent)
            .toContain("Edited heading");
          let left = false;
          for (const decision of ["keep", "discard"] as const) {
            const pending = app.leave.coordinator.request({
              scopes: "all",
              reason: "navigation",
              proceed() {
                left = true;
              },
            });
            const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
            await expect.poll(() => warning.open).toBe(true);
            await warning.updateComplete;
            await commands.parkPointer();
            await expectNoA11yViolations(warning);
            await userEvent.click(
              page.elementLocator(warning.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
            );
            expect(await pending).toBe(decision === "keep" ? "kept" : "proceeded");
            await el.updateComplete;
            expect(input.value).toBe(decision === "keep" ? "Edited heading" : "Bar");
            expect(left).toBe(decision === "discard");
          }
          expect(innerWidth).toBe(width);
          await expectNoA11yViolations(host);
          expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
        } finally {
          await page.viewport(viewport.width, viewport.height);
        }
      });
    }
  }
}

it("the Receipts tab's Cancel protects the appearance before closing", async () => {
  const { app, editor: el } = await mountReceiptTab();
  const dialog = departmentDialog(app)!.shadowRoot!.querySelector("wt-modal")!;
  await editReceipt(el, "headerSubtitle-es-ES", "Edited heading");
  const input = receiptField(el, "headerSubtitle-es-ES");
  for (const decision of ["keep", "discard"] as const) {
    await userEvent.click(
      page.elementLocator(receiptRoot(el).querySelector("[data-test=cancel-receipt]")!),
    );
    const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => warning.open).toBe(true);
    await warning.updateComplete;
    await userEvent.click(
      page.elementLocator(warning.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
    );
    await expect.poll(() => dialog.open).toBe(decision === "keep");
    if (decision === "keep") expect(input.value).toBe("Edited heading");
  }
  expect(input.isConnected).toBe(false);
  expect(leaveCoordinatorFor(app.shadowRoot!.querySelector("wt-unsaved-changes")!)!.isDirty()).toBe(
    false,
  );
});

it("an obsolete receipt department query cannot bypass a venue draft leave decision", async () => {
  const { app } = await mount("/manage/venue-settings/view/venue-details?departmentId=bar");
  const details = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect.poll(() => details.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  await userEvent.click(
    page.elementLocator(details.shadowRoot!.querySelector("[data-test=edit]")!),
  );
  await expect.poll(() => details.shadowRoot?.querySelector("[name=addressLine1]")).toBeTruthy();
  const address = details.shadowRoot!.querySelector<WtInput>("[name=addressLine1]")!;
  await address.updateComplete;
  const saved = address.value;
  await userEvent.fill(
    page.elementLocator(address.shadowRoot!.querySelector("input")!),
    "Draft street",
  );
  await select(app, "tables");
  await choose(app, "keep");
  expect(selected(app)).toBe("venue-details");
  expect(address.value).toBe("Draft street");
  await select(app, "tables");
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  expect(address.isConnected).toBe(false);
  await select(app, "venue-details");
  await expect.poll(() => selected(app)).toBe("venue-details");
  await userEvent.click(
    page.elementLocator(details.shadowRoot!.querySelector("[data-test=edit]")!),
  );
  await expect
    .poll(() => details.shadowRoot!.querySelector<WtInput>("[name=addressLine1]")?.value)
    .toBe(saved);
});

it("a legal-name change on Venue details re-reads the banner's name", async () => {
  let legalName = "Issuer SL";
  const getMe = vi.fn(async () => ({
    personId: "p1",
    email: "ada@example.com",
    role: "manager",
    locale: "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName: legalName,
    permissions: ["venue.view", "venue.configure"],
    modules: [],
  }));
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getMe,
    renameTaxpayer: async (input: { legalName: string }) => {
      legalName = input.legalName;
      const model = venueDetailsFixture();
      return { model: { ...model, issuer: { ...model.issuer, legalName } } };
    },
  } as Partial<DashboardApi>);
  const banner = () => app.shadowRoot!.querySelector("[data-test=venue-name]")!.textContent!.trim();
  await expect.poll(banner).toBe("Issuer SL");
  const panel = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect
    .poll(() => panel.shadowRoot?.querySelector("[data-test=change-legal-name]"))
    .toBeTruthy();
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-legal-name]")!.click();
  const host = panel.shadowRoot!.querySelector("dashboard-legal-name-dialog")!;
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector("wt-dialog")!;
  const input = dialog.querySelector<WtInput>("wt-input[name=legalName]")!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), "Nuevo SL");
  const calls = getMe.mock.calls.length;
  dialog.querySelector<HTMLElement>("wt-button[data-test=save-legal-name]")!.click();
  await expect.poll(banner).toBe("Nuevo SL");
  expect(getMe.mock.calls.length).toBe(calls + 1);
  expect(location.pathname).toBe("/manage/venue-settings/view/venue-details");
});

async function openLegalName(app: DashboardApp, typed?: string) {
  await select(app, "venue-details");
  await expect.poll(() => selected(app)).toBe("venue-details");
  const panel = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect
    .poll(() => panel.shadowRoot?.querySelector("[data-test=change-legal-name]"))
    .toBeTruthy();
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-legal-name]")!.click();
  const host = panel.shadowRoot!.querySelector("dashboard-legal-name-dialog")!;
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector("wt-dialog")!;
  const input = dialog.querySelector<WtInput>("wt-input[name=legalName]")!;
  await input.updateComplete;
  if (typed !== undefined)
    await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), typed);
  const native = dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
  return { host, dialog, input, native };
}

async function tabStillClickable(app: DashboardApp, key: string) {
  try {
    await userEvent.click(
      page.elementLocator(tabs(app).shadowRoot!.querySelector(`[role=tab][data-key=${key}]`)!),
      { timeout: 1000 },
    );
    return true;
  } catch {
    return false;
  }
}

it("leaving Venue details by Back and Discard closes a changed legal-name dialog", async () => {
  const { app } = await mount();
  const { host, dialog, native } = await openLegalName(app, "Proposed SL");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  await host.updateComplete;
  expect(dialog.open).toBe(false);
  expect(native.matches(":modal")).toBe(false);
  expect(await tabStillClickable(app, "tables")).toBe(true);
  await select(app, "kitchen");
  await expect.poll(() => selected(app)).toBe("kitchen");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it("a rename answered after Back and Discard closed its dialog still updates the banner", async () => {
  let legalName = "Venue";
  const getMe = vi.fn(async () => ({
    personId: "p1",
    email: "ada@example.com",
    role: "manager",
    locale: "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName: legalName,
    permissions: ["venue.view", "venue.configure"],
    modules: [],
  }));
  let answer!: () => void;
  const { app } = await mount(undefined, "en-GB", "light", {
    getMe,
    renameTaxpayer: (input: { legalName: string }) =>
      new Promise((resolve) => {
        answer = () => {
          legalName = input.legalName;
          const model = venueDetailsFixture();
          resolve({ model: { ...model, issuer: { ...model.issuer, legalName } } });
        };
      }),
  } as Partial<DashboardApi>);
  const banner = () => app.shadowRoot!.querySelector("[data-test=venue-name]")!.textContent!.trim();
  await expect.poll(banner).toBe("Venue");
  const { host, dialog, native } = await openLegalName(app, "Nuevo SL");
  dialog.querySelector<HTMLElement>("wt-button[data-test=save-legal-name]")!.click();
  await expect.poll(() => answer).toBeTypeOf("function");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  await host.updateComplete;
  expect(dialog.open).toBe(false);
  expect(native.matches(":modal")).toBe(false);
  answer();
  await expect.poll(banner).toBe("Nuevo SL");
  await host.updateComplete;
  expect(dialog.open).toBe(false);
  expect(native.matches(":modal")).toBe(false);
  expect(await tabStillClickable(app, "kitchen")).toBe(true);
});

it("a rename refused after Back and Discard closed its dialog shows nothing", async () => {
  let refuse!: () => void;
  const { app } = await mount(undefined, "en-GB", "light", {
    renameTaxpayer: () =>
      new Promise((_, reject) => {
        refuse = () =>
          reject(Object.assign(new Error("changed"), { code: "venue.detail_changed" }));
      }),
  } as Partial<DashboardApi>);
  const { host, dialog, native } = await openLegalName(app, "Nuevo SL");
  dialog.querySelector<HTMLElement>("wt-button[data-test=save-legal-name]")!.click();
  await expect.poll(() => refuse).toBeTypeOf("function");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => selected(app)).toBe("tables");
  refuse();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await host.updateComplete;
  expect(dialog.open).toBe(false);
  expect(native.matches(":modal")).toBe(false);
  expect(dialog.querySelector<WtFormActions>("wt-form-actions")!.error).toBe("");
  expect(await tabStillClickable(app, "kitchen")).toBe(true);
});

it("leaving Venue details by Back and Keep leaves the legal-name dialog open with its draft", async () => {
  const { app } = await mount();
  const { host, dialog, input, native } = await openLegalName(app, "Proposed SL");
  history.back();
  await choose(app, "keep");
  await host.updateComplete;
  expect(selected(app)).toBe("venue-details");
  expect(dialog.open).toBe(true);
  expect(native.matches(":modal")).toBe(true);
  expect(native.checkVisibility()).toBe(true);
  expect(input.value).toBe("Proposed SL");
});

it("leaving Venue details by Back closes an unchanged legal-name dialog", async () => {
  const { app } = await mount();
  const { host, dialog, native } = await openLegalName(app);
  history.back();
  await expect.poll(() => selected(app)).toBe("tables");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  await host.updateComplete;
  expect(dialog.open).toBe(false);
  expect(native.matches(":modal")).toBe(false);
  expect(await tabStillClickable(app, "kitchen")).toBe(true);
});

it("the newest banner read wins when two reads finish in the opposite order", async () => {
  const response = (venueName: string) => ({
    personId: "p1",
    email: "ada@example.com",
    role: "manager",
    locale: "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName,
    permissions: ["venue.view", "venue.configure"],
    modules: [],
  });
  const pending: ((value: ReturnType<typeof response>) => void)[] = [];
  const getMe = vi
    .fn()
    .mockResolvedValueOnce(response("Initial SL"))
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getMe,
  });
  const banner = () => app.shadowRoot!.querySelector("[data-test=venue-name]")!.textContent!.trim();
  await expect.poll(banner).toBe("Initial SL");
  const changed = () =>
    settings(app).dispatchEvent(
      new CustomEvent("venue-identity-changed", { bubbles: true, composed: true }),
    );
  changed();
  changed();
  await expect.poll(() => pending.length).toBe(2);
  pending[1]!(response("Newer SL"));
  await expect.poll(banner).toBe("Newer SL");
  pending[0]!(response("Older SL"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await app.updateComplete;
  expect(banner()).toBe("Newer SL");
});

it("a failed banner read keeps the name the banner shows", async () => {
  const getMe = vi
    .fn()
    .mockResolvedValueOnce({
      personId: "p1",
      email: "ada@example.com",
      role: "manager",
      locale: "en-GB",
      venueLocale: "en-GB",
      sessionDefault: "en-GB",
      venueName: "Initial SL",
      permissions: ["venue.view", "venue.configure"],
      modules: [],
    })
    .mockRejectedValue(new Error("network"));
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getMe,
  });
  const banner = () => app.shadowRoot!.querySelector("[data-test=venue-name]")!.textContent!.trim();
  await expect.poll(banner).toBe("Initial SL");
  settings(app).dispatchEvent(
    new CustomEvent("venue-identity-changed", { bubbles: true, composed: true }),
  );
  await expect.poll(() => getMe.mock.calls.length).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await app.updateComplete;
  expect(banner()).toBe("Initial SL");
  expect(app.shadowRoot!.querySelector("dashboard-venue-settings-screen")).not.toBeNull();
});

type DefaultsPanel = HTMLElementTagNameMap["dashboard-venue-defaults-panel"];
function defaultsPanel(app: DashboardApp) {
  return settings(app).shadowRoot!.querySelector("dashboard-venue-defaults-panel");
}
async function readyDefaults(app: DashboardApp) {
  await expect
    .poll(() => defaultsPanel(app)?.shadowRoot?.querySelector("[data-test=edit]"))
    .toBeTruthy();
  return defaultsPanel(app)!;
}
async function editDefaults(panel: DefaultsPanel) {
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
  await expect.poll(() => panel.shadowRoot!.querySelector("[name=receiptLanguage]")).toBeTruthy();
}
function languageField(panel: DefaultsPanel) {
  return panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "[name=receiptLanguage]",
  )!;
}
function defaultsSave(panel: DefaultsPanel) {
  return panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
}
function savedLanguage(panel: DefaultsPanel) {
  return panel.shadowRoot!.querySelector("[data-test=saved-receiptLanguage]")?.textContent?.trim();
}
async function pickLanguage(panel: DefaultsPanel, value: string) {
  languageField(panel).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await panel.updateComplete;
}
const defaultsModel: VenueDefaults = {
  receiptLanguage: "es-ES",
  receiptLanguageChoices: ["es-ES", "ca-ES"],
  fixedReceiptLanguage: null,
  defaultProductVatClass: "general",
};
const savedCatalan: DashboardApi["putVenueDefaults"] = async (changes) => ({
  ...defaultsModel,
  ...changes,
});

it("Venue details hosts the Defaults card, whose Save stays quiet until the draft changes", async () => {
  const put = vi.fn(savedCatalan);
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getVenueDefaults: async () => defaultsModel,
    putVenueDefaults: put,
  });
  const panel = await readyDefaults(app);
  expect(panel.checkVisibility()).toBe(true);
  await editDefaults(panel);
  const save = defaultsSave(panel);
  expect(save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
  await pickLanguage(panel, "ca-ES");
  expect(save.disabled).toBe(false);
  await save.updateComplete;
  await userEvent.click(page.elementLocator(save.shadowRoot!.querySelector("button")!));
  await expect.poll(() => put.mock.calls).toEqual([[{ receiptLanguage: "ca-ES" }]]);
  await expect.poll(() => savedLanguage(panel)).toBe(receiptLanguageName("ca-ES"));
});

it.each([["venue.view"], ["layout.configure"], ["venue.configure"]])(
  "the hosted Defaults card gate matches the server for %j",
  async (permission) => {
    const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {}, [
      permission,
    ]);
    expect(defaultsPanel(app) !== null).toBe(permission === "venue.view");
  },
);

it("saving the Defaults card preserves a separate venue-details draft", async () => {
  const put = vi.fn(savedCatalan);
  const detailsWrite = vi.fn<DashboardApi["patchVenueDetails"]>();
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getVenueDefaults: async () => defaultsModel,
    putVenueDefaults: put,
    patchVenueDetails: detailsWrite,
  });
  const panel = await readyDefaults(app);
  const details = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect.poll(() => details.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  details.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
  await expect.poll(() => details.shadowRoot!.querySelector("[name=venueName]")).toBeTruthy();
  const name = details.shadowRoot!.querySelector<WtInput>("[name=venueName]")!;
  await name.updateComplete;
  await userEvent.fill(
    page.elementLocator(name.shadowRoot!.querySelector("input")!),
    "Draft venue",
  );
  await editDefaults(panel);
  await pickLanguage(panel, "ca-ES");
  defaultsSave(panel).click();
  await expect.poll(() => put.mock.calls).toEqual([[{ receiptLanguage: "ca-ES" }]]);
  await expect.poll(() => savedLanguage(panel)).toBe(receiptLanguageName("ca-ES"));
  expect(name.value).toBe("Draft venue");
  expect(detailsWrite).not.toHaveBeenCalled();
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/venue-settings/view/venue-details");
  expect(name.value).toBe("Draft venue");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
});

it("the hosted Defaults card protects sidebar navigation through Keep and Discard", async () => {
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getVenueDefaults: async () => defaultsModel,
  });
  const panel = await readyDefaults(app);
  await editDefaults(panel);
  await pickLanguage(panel, "ca-ES");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "keep");
  expect(panel.checkVisibility()).toBe(true);
  expect(languageField(panel).value).toBe("ca-ES");
  expect(location.pathname).toBe("/manage/venue-settings/view/venue-details");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(panel.isConnected).toBe(false);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});

it("the Venue details tab's four cards are spaced evenly", async () => {
  const { app } = await mount("/manage/venue-settings/view/venue-details", "en-GB", "light", {
    getVenueDefaults: async () => defaultsModel,
  });
  const panel = await readyDefaults(app);
  const details = settings(app).shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  const day = details.shadowRoot!.querySelector("dashboard-business-day-start-editor")!;
  await expect.poll(() => day.shadowRoot?.querySelector(".settings-card")).toBeTruthy();
  const cards = [
    ...details.shadowRoot!.querySelectorAll(".settings-card"),
    day.shadowRoot!.querySelector(".settings-card")!,
    panel.shadowRoot!.querySelector(".settings-card")!,
  ].map((card) => card.getBoundingClientRect());
  expect(cards).toHaveLength(4);
  const gaps = cards.slice(1).map((card, i) => Math.round(card.top - cards[i]!.bottom));
  expect(gaps[0]).toBeGreaterThan(0);
  expect(gaps).toEqual([gaps[0], gaps[0], gaps[0]]);
});

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`hosted Defaults card layout ${locale}/${theme}/${width}`, async () => {
        registerIcons(DASHBOARD_ICONS);
        await page.viewport(width, 900);
        expect(window.innerWidth).toBe(width);
        const { app } = await mount("/manage/venue-settings/view/venue-details", locale, theme, {
          getVenueDefaults: async () => defaultsModel,
        });
        const panel = await readyDefaults(app);
        const screen = settings(app);
        const details = screen.shadowRoot!.querySelector("dashboard-venue-details-panel")!;
        expect(panel.getBoundingClientRect().top).toBeGreaterThan(
          details.getBoundingClientRect().bottom,
        );
        panel.scrollIntoView({ block: "center" });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await commands.parkPointer();
        await expectNoA11yViolations(screen);
        expect(screen.scrollWidth).toBeLessThanOrEqual(screen.clientWidth);
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
        await page.screenshot({
          element: panel,
          path: `__screenshots__/look/a755-defaults-${locale}-${theme}-${width}-saved.png`,
        });
        await editDefaults(panel);
        await pickLanguage(panel, "ca-ES");
        await expectNoA11yViolations(screen);
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
        await page.screenshot({
          element: panel,
          path: `__screenshots__/look/a755-defaults-${locale}-${theme}-${width}-draft.png`,
        });
      });
    }
  }
}
