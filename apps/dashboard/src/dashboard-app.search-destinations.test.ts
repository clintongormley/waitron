import { LitElement, html } from "lit";
import { state } from "lit/decorators.js";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { type DashboardContribution } from "@waitron/dashboard-kit";
import { UrlStateController, leaveCoordinatorFor, type WtInput } from "@waitron/ui";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";

class SearchDestinationFixture extends LitElement {
  @state() private view = "";
  @state() private mode = "";
  @state() private windowId = "";
  private url = new UrlStateController(
    this,
    () => {
      this.view = this.url.read("view") ?? "";
      this.mode = this.url.read("mode") ?? "";
      this.windowId = this.url.read("window") ?? "";
    },
    {
      basePath: "/manage",
      primary: "dashboard",
      children: { "*": { view: "view", mode: "mode", window: "window" } },
    },
  );
  override render() {
    return html`<p data-test="chosen">${this.view}/${this.mode}</p>
      <wt-dialog .open=${this.windowId === "settings"} heading="Library settings"
        ><p>Library window</p></wt-dialog
      >`;
  }
}
customElements.define("search-destination-fixture", SearchDestinationFixture);

function searchModule(): DashboardContribution {
  return {
    module: "search-fixture",
    screen: {
      id: "search-library",
      navLabelKey: "search.library",
      group: "service",
      requiresPermission: "library.edit",
      readPermission: "library.read",
    },
    moreScreens: [
      {
        screen: {
          id: "search-reports",
          navLabelKey: "search.stock",
          group: "reports",
          requiresPermission: "library.read",
        },
        create: () => ({ render: () => html`<p>Stock report</p>` }),
      },
    ],
    searchDestinations: [
      {
        id: "library:stock",
        screen: "search-library",
        labelKey: "search.stock",
        path: "/manage/search-library/view/stock/mode/person",
      },
      {
        id: "library:window",
        screen: "search-library",
        labelKey: "search.settings",
        path: "/manage/search-library/view/stock/window/settings",
      },
      {
        id: "library:secret",
        screen: "search-library",
        labelKey: "search.secret",
        path: "/manage/search-library/view/secret",
        requiresPermission: "library.secret",
      },
    ],
    strings: {
      en: {
        "search.library": "Library",
        "search.stock": "Stock",
        "search.settings": "Library settings",
        "search.secret": "Secret",
      },
      es: {
        "search.library": "Biblioteca",
        "search.stock": "Existencias",
        "search.settings": "Ajustes de biblioteca",
        "search.secret": "Secreto",
      },
    },
    create: () => ({
      render: () => html`<search-destination-fixture></search-destination-fixture>`,
    }),
  };
}
vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [searchModule()],
}));
const originalViewport: [number, number] = [window.innerWidth, window.innerHeight];
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  vi.restoreAllMocks();
  await page.viewport(...originalViewport);
});
async function mount(
  options: {
    path?: string;
    permissions?: string[];
    modules?: string[];
    locale?: string;
    width?: number;
    theme?: "light" | "dark";
  } = {},
) {
  await page.viewport(options.width ?? 1280, 800);
  history.replaceState(null, "", options.path ?? "/manage/search-library");
  const api = {
    getMe: vi
      .fn()
      .mockResolvedValue({
        personId: "p1",
        role: "manager",
        email: "ada@example.com",
        locale: options.locale ?? "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Library test",
        permissions: options.permissions ?? ["library.read"],
        modules: options.modules ?? ["search-fixture"],
      }),
    getGoogleConfig: async () => ({ configured: false }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getSalesOverview: () => new Promise(() => undefined),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<DashboardApp>(
    "dashboard-app",
    { api, request: async () => [] as never },
    options.theme,
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=nav-search]")).not.toBeNull(),
  );
  if (options.width === 390) {
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!);
  }
  return el;
}
const box = (el: DashboardApp) => el.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
async function search(el: DashboardApp, query: string) {
  box(el).focus();
  box(el).shadowRoot!.querySelector("input")!.select();
  await userEvent.keyboard(query || "{Backspace}");
  await el.updateComplete;
}
const results = (el: DashboardApp) =>
  Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item,.nav-destination")).filter(
    (x) => x.checkVisibility(),
  );
const destination = (el: DashboardApp, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-search-destination="${id}"]`);
const fixture = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<SearchDestinationFixture>("search-destination-fixture")!;

it("keeps all matching pages ahead of inner results across groups and labels their containing page", async () => {
  const el = await mount();
  await search(el, "stock");
  expect(results(el).map((x) => x.textContent!.trim())).toEqual(["Stock", "Stock — in Library"]);
  await userEvent.click(destination(el, "library:stock")!);
  await vi.waitFor(() =>
    expect(location.pathname).toBe("/manage/search-library/view/stock/mode/person"),
  );
  await vi.waitFor(() =>
    expect(fixture(el).shadowRoot!.querySelector("[data-test=chosen]")!.textContent).toBe(
      "stock/person",
    ),
  );
  expect(box(el).value).toBe("");
});
it("Enter opens the same complete inner address and preserves blank ordinary navigation", async () => {
  const el = await mount();
  expect(destination(el, "library:stock")).toBeNull();
  await search(el, "stock library");
  box(el).focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(location.pathname).toBe("/manage/search-library/view/stock/mode/person"),
  );
  expect(box(el).value).toBe("");
});
it("opens a window from an address and restores it through Back Forward and a fresh mount", async () => {
  const el = await mount();
  await search(el, "settings");
  await userEvent.click(destination(el, "library:window")!);
  await vi.waitFor(() =>
    expect(fixture(el).shadowRoot!.querySelector("wt-dialog")!.open).toBe(true),
  );
  expect(location.pathname).toBe("/manage/search-library/view/stock/window/settings");
  history.back();
  await vi.waitFor(() =>
    expect(fixture(el).shadowRoot!.querySelector("wt-dialog")!.open).toBe(false),
  );
  history.forward();
  await vi.waitFor(() =>
    expect(fixture(el).shadowRoot!.querySelector("wt-dialog")!.open).toBe(true),
  );
  const path = location.pathname;
  cleanupWidgets();
  const refreshed = await mount({ path });
  await vi.waitFor(() =>
    expect(fixture(refreshed).shadowRoot!.querySelector("wt-dialog")!.open).toBe(true),
  );
});
it("keeps same-page drafts and the phone search on Keep, then navigates only after Discard", async () => {
  const el = await mount({ width: 390 });
  let value = "saved";
  const scope = leaveCoordinatorFor(el)!.register({
    id: fixture(el),
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  value = "edited";
  scope.changed();
  await search(el, "stock library");
  await userEvent.click(destination(el, "library:stock")!);
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  await question.updateComplete;
  await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  await vi.waitFor(() => expect(question.open).toBe(false));
  expect(location.pathname).toBe("/manage/search-library");
  expect(value).toBe("edited");
  expect(box(el).value).toBe("stock library");
  expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(true);
  await userEvent.click(destination(el, "library:stock")!);
  await vi.waitFor(() => expect(question.open).toBe(true));
  await question.updateComplete;
  await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await vi.waitFor(() =>
    expect(location.pathname).toBe("/manage/search-library/view/stock/mode/person"),
  );
  expect(value).toBe("saved");
  expect(box(el).value).toBe("");
  expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(false);
});
it.each([{ modules: [] }, { permissions: [] }, { permissions: ["library.read"] }])(
  "filters disabled modules, unreadable parents and denied child gates: %j",
  async (options) => {
    const el = await mount(options);
    await search(el, "secret");
    expect(destination(el, "library:secret")).toBeNull();
    await search(el, "stock library");
    expect(destination(el, "library:stock") !== null).toBe(
      options.permissions?.includes("library.read") ?? false,
    );
  },
);
it("switches inner and containing labels with the locale without clearing the query", async () => {
  const el = await mount();
  await search(el, "stock");
  setLocale("es-ES");
  await el.updateComplete;
  expect(box(el).value).toBe("stock");
  expect(destination(el, "library:stock")).toBeNull();
  await search(el, "existencias");
  expect(destination(el, "library:stock")!.textContent!.trim()).toBe("Existencias — en Biblioteca");
});
it.each(["light", "dark"] as const)("inner search results are accessible in %s", async (theme) => {
  const el = await mount({ theme });
  await search(el, "stock library");
  expect(destination(el, "library:stock")!.checkVisibility()).toBe(true);
  await expectNoA11yViolations(el.shadowRoot!.querySelector("nav")!);
});
