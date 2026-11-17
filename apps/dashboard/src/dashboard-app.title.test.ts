import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { es } from "./i18n/strings.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { stubShellApi } from "./testing/venue-logo-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

const original = { locale: currentLocale(), path: location.href, title: document.title };
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setLocale(original.locale);
  history.replaceState(null, "", original.path);
  document.title = original.title;
});

async function mount(api: DashboardApi, path: string): Promise<DashboardApp> {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    request: vi.fn(async () => {
      throw new Error("Unexpected module request");
    }),
  });
  return el;
}

it.each([
  { locale: "en-GB", diagnostics: "Diagnostics · Waitron", overview: "Overview · Waitron" },
  {
    locale: "es-ES",
    diagnostics: `${es["nav.diagnostics"]} · Waitron`,
    overview: `${es["nav.overview"]} · Waitron`,
  },
] as const)(
  "the browser tab names the open screen in $locale and follows navigation",
  async ({ locale, diagnostics, overview }) => {
    setLocale(locale);
    const el = await mount(stubShellApi(true, locale), "/diagnostics");
    await vi.waitFor(() => expect(document.title).toBe(diagnostics));
    let link: HTMLElement | null = null;
    await vi.waitFor(() => {
      link = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]");
      expect(link).not.toBeNull();
    });
    link!.click();
    await vi.waitFor(() => expect(document.title).toBe(overview));
  },
);

it("the browser tab's title changes language with the dashboard", async () => {
  setLocale("en-GB");
  await mount(stubShellApi(true, "en-GB"), "/diagnostics");
  await vi.waitFor(() => expect(document.title).toBe("Diagnostics · Waitron"));
  setLocale("es-ES");
  await vi.waitFor(() => expect(document.title).toBe(`${es["nav.diagnostics"]} · Waitron`));
});

it.each([
  { locale: "en-GB", title: "Waitron Dashboard" },
  { locale: "es-ES", title: "Panel de Waitron" },
] as const)("the sign-in page's tab reads $title in $locale", async ({ locale, title }) => {
  setLocale(locale);
  document.title = "";
  const el = await mount(stubShellApi(false, locale), "/");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull(),
  );
  await vi.waitFor(() => expect(document.title).toBe(title));
});
