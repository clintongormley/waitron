import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, MenuHome, MenuReadPart } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";
import {
  cleanupWidgets,
  documentProduct,
  menuDocument,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import type { MenusScreen } from "./menus-screen.js";
import "./menus-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

class HomeShortcutsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("home-shortcuts-leave-test-app", HomeShortcutsLeaveApp);

const home: MenuHome = {
  homeSectionId: "home",
  shortcuts: [],
  handheld: { columns: 3, tiles: "colours", order: "home_first" },
  till: { columns: 6, tiles: "colours", order: "home_first" },
};

/** A menu holding Lager and Burger, with an empty Device Home Page. `afterAdd` answers every read
 * of the home once an add has been sent. */
function client(addHomeShortcut: () => Promise<unknown>, afterAdd: () => Promise<MenuHome>) {
  let added = false;
  const api = {
    listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
    listLibraryProducts: async () =>
      ["p-lager", "p-burger"].map((id) => ({
        id,
        name: id === "p-lager" ? "Lager" : "Burger",
        active: true,
        modifiers: [],
        variants: [],
      })),
    listCategories: async () => [],
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
    addHomeShortcut: vi.fn(async () => {
      added = true;
      return addHomeShortcut();
    }),
    getMenuStructure: () => reads.structure(),
    getMenuHome: () => reads.home(),
    getMenuStatus: () => reads.status(),
    getMenuPreview: () => reads.preview(),
    getMenuRead: async (_id: string, parts: readonly MenuReadPart[]) =>
      Object.fromEntries(
        await Promise.all(
          parts.map(async (part) => {
            try {
              return [part, { status: 200, body: await reads[part]() }];
            } catch (error) {
              return [part, { status: 409, body: { error } }];
            }
          }),
        ),
      ),
  } as unknown as DashboardApi & { addHomeShortcut: ReturnType<typeof vi.fn> };
  const reads = {
    structure: async () => ({
      rootSectionId: "root",
      root: { id: "root", internalName: "Menu", names: {}, image: null, color: null, members: [] },
      includable: [],
      includedBy: [],
      nodes: ["p-lager", "p-burger"].map((productId) => ({
        memberId: `m-${productId}`,
        ref: { kind: "product", productId },
      })),
    }),
    home: () => (added ? afterAdd() : Promise.resolve(home)),
    status: async () => ({ state: "unpublished", clashes: 0 }),
    preview: async () => ({
      live: null,
      clashes: [],
      hash: "b".repeat(64),
      changes: [],
      warnings: [],
      status: { state: "unpublished", clashes: 0 },
      document: menuDocument(
        [documentProduct("mi-lager", "p-lager"), documentProduct("mi-burger", "p-burger")],
        { "p-lager": "Lager", "p-burger": "Burger" },
      ),
    }),
  };
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function mount(api: DashboardApi) {
  history.replaceState(null, "", "/manage/menus/menu/menu/view/home");
  const { el: app } = await mountWidget<HomeShortcutsLeaveApp>("home-shortcuts-leave-test-app", {
    api,
  });
  const screen = app.shadowRoot!.querySelector<MenusScreen>("dashboard-menus-screen")!;
  const preview = () => screen.shadowRoot!.querySelector("dashboard-device-home-preview");
  await vi.waitFor(() => expect(preview()?.shortcuts).toBeTruthy());
  await preview()!.updateComplete;
  preview()!.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  const window = () =>
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      'wt-modal[data-test="add-shortcut"]',
    )!;
  await vi.waitFor(() => expect(window().open).toBe(true));
  const picker = () => window().querySelector("dashboard-home-shortcut-picker")!;
  await vi.waitFor(() => expect(picker()).not.toBeNull());
  await picker().updateComplete;
  return { app, screen, window, picker };
}

async function choose(
  picker: HTMLElementTagNameMap["dashboard-home-shortcut-picker"],
  ids: string[],
) {
  await chooseOptions(picker.shadowRoot!.querySelector("wt-combobox")!, ids);
  await picker.updateComplete;
}

async function question(app: HomeShortcutsLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

function cancel(window: HTMLElementTagNameMap["wt-modal"]): void {
  window.querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!.click();
}

it("closes on Cancel without asking when nothing is chosen", async () => {
  const { app, window } = await mount(
    client(
      async () => ({}),
      async () => home,
    ),
  );
  cancel(window());
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect((await question(app)).open).toBe(false);
});

it("asks before Cancel discards a choice, and Keep leaves the window open", async () => {
  const { app, window, picker } = await mount(
    client(
      async () => ({}),
      async () => home,
    ),
  );
  await choose(picker(), ["p-lager"]);
  cancel(window());
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(() => expect(q.open).toBe(false));
  expect(window().open).toBe(true);
});

it("commits the adds before closing, so a failed read of the home afterwards asks nothing", async () => {
  const api = client(
    async () => ({}),
    async () => {
      throw { code: "connection.failed" };
    },
  );
  const { app, window, picker } = await mount(api);
  await choose(picker(), ["p-lager", "p-burger"]);
  picker().shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(api.addHomeShortcut).toHaveBeenCalledTimes(2);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("keeps a refused choice, and Cancel then asks", async () => {
  const api = client(
    async () => {
      throw { code: "server.internal" };
    },
    async () => home,
  );
  const { app, window, picker } = await mount(api);
  await choose(picker(), ["p-lager"]);
  picker().shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
  await vi.waitFor(() => expect(api.addHomeShortcut).toHaveBeenCalled());
  await vi.waitFor(() => expect(picker().formError).not.toBe(""));
  await vi.waitFor(() =>
    expect(
      window().querySelector<HTMLElement & { disabled: boolean }>(
        '[data-test="add-shortcut-cancel"]',
      )!.disabled,
    ).toBe(false),
  );
  expect(picker().shadowRoot!.querySelector("wt-combobox")!.values).toEqual(["p-lager"]);
  cancel(window());
  await vi.waitFor(async () => expect((await question(app)).open).toBe(true));
  expect(window().open).toBe(true);
});

it("still asks after the window's picker was taken out of the page and put back", async () => {
  const { app, window, picker } = await mount(
    client(
      async () => ({}),
      async () => home,
    ),
  );
  await choose(picker(), ["p-lager"]);
  await reattachAfterDetachedUpdate(picker());
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(window());
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  expect(window().open).toBe(true);
});

it("still asks after the screen was taken out of the page and put back", async () => {
  const { app, screen, window, picker } = await mount(
    client(
      async () => ({}),
      async () => home,
    ),
  );
  await choose(picker(), ["p-lager"]);
  await reattachAfterDetachedUpdate(screen);
  await vi.waitFor(() => expect(window()?.open).toBe(true));
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(window());
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
});
