import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOptions, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, MenuHome } from "../api/client.js";
import type { MenuReadPart } from "../api/menu-api.js";
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
  order: "home_first",
};

function client(
  save: DashboardApi["saveMenuHome"] = async () => ({ ...home, dropped: [] }),
  afterSave: () => Promise<MenuHome> = async () => home,
  initial = home,
) {
  let sent = false;
  const api = {
    listMenus: async () => [{ id: "menu", name: "Menu", active: true }],
    listLibraryProducts: async () =>
      ["p-lager", "p-burger"].map((id) => ({
        id,
        name: id === "p-lager" ? "Lager" : "Burger",
        active: true,
        modifiers: [],
        variants: [],
      })),
    listCategories: async () => [],
    getMenuSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
    saveMenuHome: vi.fn<DashboardApi["saveMenuHome"]>(async (id, draft) => {
      sent = true;
      return save(id, draft);
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
  } as unknown as DashboardApi & {
    saveMenuHome: ReturnType<typeof vi.fn<DashboardApi["saveMenuHome"]>>;
  };
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
    prices: async () => [],
    home: () => (sent ? afterSave() : Promise.resolve(initial)),
    status: async () => ({ state: "unpublished", clashes: 0 }),
    preview: async () => ({
      setMenuProblems: [],
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
  history.replaceState(null, "", "/menus/menu/menu/view/home");
  const { el: app } = await mountWidget<HomeShortcutsLeaveApp>("home-shortcuts-leave-test-app", {
    api,
  });
  const screen = app.shadowRoot!.querySelector<MenusScreen>("dashboard-menus-screen")!;
  const preview = () => screen.shadowRoot!.querySelector("dashboard-device-home-preview");
  await vi.waitFor(() => expect(preview()?.shortcuts).toBeTruthy());
  await preview()!.updateComplete;
  preview()!.shadowRoot!.querySelector<HTMLElement>('[data-test="add-shortcuts"]')!.click();
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
  await chooseOptions(
    picker.shadowRoot!.querySelector("wt-combobox")!,
    ids.map((id) => "product:" + id),
  );
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
  const { app, window } = await mount(client());
  cancel(window());
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect((await question(app)).open).toBe(false);
});

it("asks before Escape discards a choice, and Keep leaves the window open", async () => {
  const { app, window, picker } = await mount(client());
  await choose(picker(), ["p-lager"]);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(() => expect(q.open).toBe(false));
  expect(window().open).toBe(true);
});

const pressAdd = (picker: HTMLElementTagNameMap["dashboard-home-shortcut-picker"]) =>
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
const control = (screen: MenusScreen) => screen.shadowRoot!.querySelector("wt-segmented-control")!;
const actions = (screen: MenusScreen) =>
  screen.shadowRoot!.querySelector('[data-test="home-save"]')!.closest("wt-form-actions")!;
const savePage = (screen: MenusScreen) =>
  screen.shadowRoot!.querySelector<HTMLElement>('[data-test="home-save"]')!.click();

it("stages shortcut edits and Shown first before sending one ordered Save", async () => {
  const api = client(undefined, undefined, {
    ...home,
    shortcuts: [
      {
        memberId: "missing",
        position: 0,
        ref: { kind: "missing", name: "Soup" },
        name: "Soup",
        reachable: false,
        missingName: "Soup",
      },
    ],
  });
  const { screen, window, picker } = await mount(api);
  await choose(picker(), ["p-lager", "p-burger"]);
  pressAdd(picker());
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(api.saveMenuHome).not.toHaveBeenCalled();

  const preview = screen.shadowRoot!.querySelector("dashboard-device-home-preview")!;
  await preview.updateComplete;
  const [missing, lager, burger] = preview.shortcuts!;
  preview.dispatchEvent(
    new CustomEvent("wt-shortcut-remove", { detail: { memberId: missing!.memberId } }),
  );
  preview.dispatchEvent(
    new CustomEvent("wt-shortcut-move", { detail: { memberId: burger!.memberId, to: 0 } }),
  );
  control(screen).dispatchEvent(new CustomEvent("wt-change", { detail: { value: "menu_first" } }));
  await screen.updateComplete;
  expect(api.saveMenuHome).not.toHaveBeenCalled();
  savePage(screen);
  await vi.waitFor(() =>
    expect(api.saveMenuHome).toHaveBeenCalledExactlyOnceWith("menu", {
      order: "menu_first",
      shortcuts: [burger, lager].map((tile) => ({ memberId: tile!.memberId, ref: tile!.ref })),
    }),
  );
});

it("commits a successful Save before a failed refresh and names dropped tiles beside Save", async () => {
  const api = client(
    async (_id, draft) => ({
      ...home,
      order: draft.order,
      dropped: [{ memberId: draft.shortcuts[0]!.memberId, reason: "deleted" }],
    }),
    async () => {
      throw { code: "connection.failed" };
    },
  );
  const { app, screen, window, picker } = await mount(api);
  await choose(picker(), ["p-lager"]);
  pressAdd(picker());
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(app.leave.coordinator.isDirty()).toBe(true);
  savePage(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector('[data-test="home-load-error"]')).not.toBeNull(),
  );
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(screen.shadowRoot!.querySelector('[data-test="home-dropped"]')?.textContent).toContain(
    "Lager",
  );
  expect(await formMessageOf(actions(screen))).toBeFalsy();
});

it("keeps the draft after a refused Save and asks before Cancel discards it", async () => {
  const api = client(async () => {
    throw { code: "connection.failed" };
  });
  const { app, screen, window, picker } = await mount(api);
  await choose(picker(), ["p-lager"]);
  pressAdd(picker());
  await vi.waitFor(() => expect(window().open).toBe(false));
  const preview = screen.shadowRoot!.querySelector("dashboard-device-home-preview")!;
  savePage(screen);
  await vi.waitFor(async () => expect(await formMessageOf(actions(screen))).toBeTruthy());
  expect(preview.shortcuts?.map(({ name }) => name)).toEqual(["Lager"]);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>('[data-test="home-cancel"]')!.click();
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await vi.waitFor(() => expect(preview.shortcuts).toEqual([]));
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("still asks after the window's picker was taken out of the page and put back", async () => {
  const { app, window, picker } = await mount(client());
  await choose(picker(), ["p-lager"]);
  await reattachAfterDetachedUpdate(picker());
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  expect(window().open).toBe(true);
});

it("still asks after the screen was taken out of the page and put back", async () => {
  const { app, screen, window, picker } = await mount(client());
  await choose(picker(), ["p-lager"]);
  await reattachAfterDetachedUpdate(screen);
  await vi.waitFor(() => expect(window()?.open).toBe(true));
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
});
