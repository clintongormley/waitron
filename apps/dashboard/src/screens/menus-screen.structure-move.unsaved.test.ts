import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, MenuReadPart, MenuStructureNode } from "../api/client.js";
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

class StructureMoveLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("structure-move-leave-test-app", StructureMoveLeaveApp);

/** A menu holding Burger at its top level and an empty Drinks section. */
function client(moveSectionMembersInto: () => Promise<unknown>) {
  const nodes: MenuStructureNode[] = [
    { memberId: "m-burger", ref: { kind: "product", productId: "p-burger" } },
    {
      memberId: "m-drinks",
      ref: { kind: "section", sectionId: "s-drinks" },
      internalName: "Drinks",
      names: {},
      image: null,
      color: null,
      ownerMenuId: "menu",
      children: [],
    },
  ];
  const reads = {
    structure: async () => ({
      rootSectionId: "root",
      root: { id: "root", internalName: "Menu", names: {}, image: null, color: null, members: [] },
      includable: [],
      includedBy: [],
      nodes: structuredClone(nodes),
    }),
    home: async () => ({
      homeSectionId: "home",
      shortcuts: [],
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 6, tiles: "colours", order: "home_first" },
    }),
    status: async () => ({ state: "unpublished", clashes: 0 }),
    preview: async () => ({
      live: null,
      clashes: [],
      hash: "b".repeat(64),
      changes: [],
      warnings: [],
      status: { state: "unpublished", clashes: 0 },
      document: menuDocument([documentProduct("mi-burger", "p-burger")], { "p-burger": "Burger" }),
    }),
  };
  const api = {
    listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
    listLibraryProducts: async () => [
      { id: "p-burger", name: "Burger", active: true, modifiers: [], variants: [] },
    ],
    listCategories: async () => [],
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
    getMenuPrices: async () => [],
    moveSectionMembersInto: vi.fn(moveSectionMembersInto),
    getMenuStructure: () => reads.structure(),
    getMenuHome: () => reads.home(),
    getMenuStatus: () => reads.status(),
    getMenuPreview: () => reads.preview(),
    getMenuRead: async (_id: string, parts: readonly MenuReadPart[]) =>
      Object.fromEntries(
        await Promise.all(
          parts.map(async (part) => [part, { status: 200, body: await reads[part]() }]),
        ),
      ),
  } as unknown as DashboardApi & { moveSectionMembersInto: ReturnType<typeof vi.fn> };
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function mount(api: DashboardApi) {
  history.replaceState(null, "", "/manage/menus/menu/menu/view/structure");
  const { el: app } = await mountWidget<StructureMoveLeaveApp>("structure-move-leave-test-app", {
    api,
  });
  const screen = app.shadowRoot!.querySelector<MenusScreen>("dashboard-menus-screen")!;
  const tree = () => screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
  const rows = () => tree().shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  await vi.waitFor(() =>
    expect(rows().querySelector('tr[data-row-key="m-burger"]')).not.toBeNull(),
  );
  screen.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!.click();
  await vi.waitFor(() =>
    expect(rows().querySelector('[data-test="select-m-burger"]')).not.toBeNull(),
  );
  rows().querySelector<HTMLInputElement>('[data-test="select-m-burger"]')!.click();
  const move = () =>
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="selection-move"]',
    )!;
  await vi.waitFor(() => expect(move().disabled).toBe(false));
  move().click();
  const window = () =>
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      'wt-modal[data-test="move-selected"]',
    )!;
  await vi.waitFor(() => expect(window().open).toBe(true));
  const destination = () =>
    window().querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[name="destination"]',
    )!;
  await vi.waitFor(() => expect(destination()).not.toBeNull());
  return { app, screen, window, destination };
}

async function question(app: StructureMoveLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

function cancel(window: HTMLElementTagNameMap["wt-modal"]): void {
  window.querySelector<HTMLElement>('[data-test="move-selected-cancel"]')!.click();
}

it("closes on Cancel without asking when no destination is chosen", async () => {
  const { app, window } = await mount(client(async () => []));
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(window());
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect((await question(app)).open).toBe(false);
});

it("asks before Cancel discards a chosen destination, and Keep leaves the window open", async () => {
  const { app, window, destination } = await mount(client(async () => []));
  await chooseOption(destination(), "s-drinks");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(window());
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(() => expect(q.open).toBe(false));
  expect(window().open).toBe(true);
  expect(destination().value).toBe("s-drinks");
});

it("asks before Escape discards a chosen destination, and Discard closes it", async () => {
  const { app, window, destination } = await mount(client(async () => []));
  await chooseOption(destination(), "s-drinks");
  destination().focus();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("commits the move before closing, so nothing is left to ask about", async () => {
  const api = client(async () => []);
  const { app, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(api.moveSectionMembersInto).toHaveBeenCalledOnce();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("keeps a refused choice, and Cancel then asks", async () => {
  const api = client(async () => {
    throw { code: "menu_section.member_duplicate" };
  });
  const { app, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(api.moveSectionMembersInto).toHaveBeenCalled());
  await vi.waitFor(() =>
    expect(
      window().querySelector<HTMLElement & { disabled: boolean }>(
        '[data-test="move-selected-cancel"]',
      )!.disabled,
    ).toBe(false),
  );
  expect(destination().value).toBe("s-drinks");
  cancel(window());
  await vi.waitFor(async () => expect((await question(app)).open).toBe(true));
  expect(window().open).toBe(true);
});

it("still asks after the screen was taken out of the page and put back", async () => {
  const { app, screen, window, destination } = await mount(client(async () => []));
  await chooseOption(destination(), "s-drinks");
  await reattachAfterDetachedUpdate(screen);
  await vi.waitFor(() => expect(window()?.open).toBe(true));
  await vi.waitFor(() => expect(app.leave.coordinator.isDirty()).toBe(true));
  cancel(window());
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  expect(window().open).toBe(true);
});
