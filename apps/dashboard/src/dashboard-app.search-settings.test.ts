import { html } from "lit";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { navigationGuardFor } from "@waitron/ui";
import { setLocale, type DashboardSettingCandidate } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { mountReceiptApp } from "./testing/department-receipt-app-fixture.js";
import {
  searchBox,
  searchResult,
  settingChooser,
  searchSettings,
  chooseSettingRow,
  cancelSettingSearch,
} from "./testing/setting-search-fixture.js";
const state = vi.hoisted(() => ({ resolve: vi.fn(), contexts: [] as unknown[] }));
vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [
    {
      module: "venue-service",
      screen: {
        id: "venue-operations",
        navLabelKey: "fixture.departments",
        group: "operations",
        requiresPermission: "venue.configure",
        readPermission: "venue.view",
      },
      strings: {
        en: {
          "fixture.departments": "Departments",
          "fixture.reminder": "Reminder",
          "fixture.service": "Service",
        },
        es: {
          "fixture.departments": "Departamentos",
          "fixture.reminder": "Aviso",
          "fixture.service": "Servicio",
        },
      },
      create: (ctx: unknown) => {
        state.contexts.push(ctx);
        return { render: () => html`<p>Departments</p>` };
      },
      searchDestinations: [
        {
          kind: "setting",
          id: "reminder",
          screen: "venue-operations",
          labelKey: "fixture.reminder",
          locationKey: "fixture.service",
          requiresPermission: "venue.configure",
          resolve: (ctx: unknown) => state.resolve(ctx),
        },
      ],
    },
  ],
}));
const row = (
  id: string,
  path = `/venue-operations/department/${id}`,
): DashboardSettingCandidate => ({ id, label: id === "bar" ? "Bar" : "Restaurant", path });
const originalViewport: [number, number] = [window.innerWidth, window.innerHeight];
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  state.resolve.mockReset();
  state.contexts.length = 0;
  vi.restoreAllMocks();
  await page.viewport(...originalViewport);
});
async function mount() {
  const { app } = await mountReceiptApp({ path: "/overview" });
  await searchSettings(app, "reminder");
  return app;
}
async function open(app: Awaited<ReturnType<typeof mount>>) {
  await userEvent.click(searchResult(app, "reminder")!);
}
const action = (app: Awaited<ReturnType<typeof mount>>, name: string) =>
  settingChooser(app)!.querySelector<HTMLElement>(`[data-test=setting-${name}]`)!;
it("one candidate opens directly using the mounted module context and clears the search", async () => {
  state.resolve.mockResolvedValue([row("bar")]);
  const app = await mount();
  expect(searchResult(app, "reminder")!.textContent).toContain("Departments / Service");
  await open(app);
  await expect.poll(() => location.pathname).toBe("/venue-operations/department/bar");
  expect(state.resolve.mock.calls[0]![0]).toBe(state.contexts[0]);
  expect(searchBox(app).value).toBe("");
});
it("chooses among all rows, starts quiet, re-resolves identity and opens its refreshed path with keyboard", async () => {
  state.resolve
    .mockResolvedValueOnce([row("bar"), row("restaurant")])
    .mockResolvedValue([row("bar", "/venue-operations/department/bar/view/service")]);
  await page.viewport(390, 800);
  const app = await mount();
  searchBox(app).focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
  const field = settingChooser(app)!.querySelector("wt-combobox")!;
  expect(field.options.map((x) => x.value)).toEqual(["bar", "restaurant"]);
  expect(action(app, "open").getAttribute("variant")).toBe("secondary");
  expect((action(app, "open") as HTMLElementTagNameMap["wt-button"]).disabled).toBe(true);
  await expectNoA11yViolations(settingChooser(app)!);
  field.focus();
  await userEvent.keyboard("{Enter}{Enter}");
  await expect
    .poll(() => (action(app, "open") as HTMLElementTagNameMap["wt-button"]).disabled)
    .toBe(false);
  await userEvent.click(action(app, "open"));
  await expect.poll(() => location.pathname).toBe("/venue-operations/department/bar/view/service");
  expect(state.resolve).toHaveBeenCalledTimes(2);
});
it("no candidates explains, and Cancel retains query and address", async () => {
  state.resolve.mockResolvedValue([]);
  const app = await mount();
  await open(app);
  await expect.poll(() => settingChooser(app)?.textContent).toContain("No available");
  expect(settingChooser(app)!.querySelector("wt-combobox")).toBeNull();
  await cancelSettingSearch(app);
  await expect.poll(() => settingChooser(app)).toBeNull();
  expect(searchBox(app).value).toBe("reminder");
  expect(location.pathname).toBe("/overview");
});
it("failed reads offer Retry and can then open", async () => {
  state.resolve.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue([row("bar")]);
  const app = await mount();
  await open(app);
  await expect.poll(() => settingChooser(app)?.textContent).toContain("Retry");
  await userEvent.click(action(app, "retry"));
  await expect.poll(() => location.pathname).toBe("/venue-operations/department/bar");
});
it.each(["vanished", "invalid"])(
  "explains a %s chosen candidate without opening a substitute",
  async (mode) => {
    state.resolve
      .mockResolvedValueOnce([row("bar"), row("restaurant")])
      .mockResolvedValue(
        mode === "vanished"
          ? [row("restaurant")]
          : [row("bar", "https://outside.example/venue-operations")],
      );
    const app = await mount();
    await open(app);
    await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
    await chooseSettingRow(app, "bar");
    await userEvent.click(action(app, "open"));
    await expect.poll(() => settingChooser(app)?.textContent).toContain("no longer available");
    expect(location.pathname).toBe("/overview");
    expect(searchBox(app).value).toBe("reminder");
  },
);
it.each(["cancel", "new activation", "session exit", "disconnect", "back"])(
  "retires a late answer after %s",
  async (mode) => {
    let finish!: (rows: DashboardSettingCandidate[]) => void;
    const pending = new Promise<DashboardSettingCandidate[]>((resolve) => {
      finish = resolve;
    });
    state.resolve.mockReturnValueOnce(pending).mockResolvedValue([]);
    const app = await mount();
    if (mode === "back") await navigationGuardFor(window)!.write("/venue-operations");
    await open(app);
    await expect.poll(() => settingChooser(app)).toBeTruthy();
    if (mode === "cancel") await cancelSettingSearch(app);
    else if (mode === "new activation") {
      searchResult(app, "reminder")!.click();
      await expect.poll(() => settingChooser(app)?.textContent).toContain("No available");
    } else if (mode === "back") {
      history.back();
      await expect.poll(() => location.pathname).toBe("/overview");
    } else if (mode === "session exit")
      window.dispatchEvent(
        new CustomEvent("waitron-session-invalid", {
          detail: { code: "management_session.expired" },
        }),
      );
    else app.remove();
    expect(app.isConnected).toBe(mode !== "disconnect");
    finish(mode === "disconnect" ? [] : [row("bar")]);
    await pending;
    await app.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(location.pathname).not.toContain("/department/bar");
    if (mode === "disconnect") expect(settingChooser(app)).toBeNull();
    if (mode === "new activation")
      expect(settingChooser(app)?.textContent).toContain("No available");
  },
);
it("a changed permission removes a pending setting and refuses its answer", async () => {
  let finish!: (rows: DashboardSettingCandidate[]) => void;
  state.resolve.mockImplementation(
    () =>
      new Promise<DashboardSettingCandidate[]>((resolve) => {
        finish = resolve;
      }),
  );
  let permissions = ["venue.configure", "venue.view"];
  const { app } = await mountReceiptApp({
    path: "/overview",
    respond: (path) =>
      path === "/management-api/session/me"
        ? Promise.resolve(
            Response.json({
              personId: "p1",
              role: "manager",
              locale: "en-GB",
              permissions,
              modules: ["venue-service"],
            }),
          )
        : undefined,
  });
  await searchSettings(app, "reminder");
  await open(app);
  permissions = ["venue.view"];
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.poll(() => searchResult(app, "reminder")).toBeNull();
  finish([row("bar")]);
  await app.updateComplete;
  await expect.poll(() => settingChooser(app)?.textContent).toContain("no longer available");
  expect(location.pathname).toBe("/overview");
});
