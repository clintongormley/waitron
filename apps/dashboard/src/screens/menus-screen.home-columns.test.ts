import { afterEach, expect, it, vi } from "vitest";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import type {
  DashboardApi,
  MenuHome,
  MenuReadPart,
  MenuReadResult,
  MenuStructure,
  MenuPreview,
} from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, menuDocument, mountWidget } from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";

afterEach(cleanupWidgets);

it.each(["en", "es-ES"])(
  "saves only the offered handheld and till column limits (%s)",
  async (locale) => {
    const before = currentLocale();
    setLocale(locale);
    try {
      const home: MenuHome = {
        homeSectionId: "home",
        shortcuts: [],
        ...structuredClone(HOME_DISPLAY_DEFAULTS),
        handheld: { ...HOME_DISPLAY_DEFAULTS.handheld, columns: 2 },
      };
      const structure: MenuStructure = {
        rootSectionId: "root",
        root: {
          id: "root",
          internalName: "Carta",
          names: {},
          image: null,
          color: null,
          members: [],
        },
        nodes: [],
        includable: [],
        includedBy: [],
      };
      const preview: MenuPreview = {
        live: null,
        hash: "hash",
        clashes: [],
        changes: [],
        warnings: [],
        status: { state: "unpublished", clashes: 0 },
        document: menuDocument([], {}),
      };
      const setHomeDisplay = vi.fn(
        async (_id: string, device: "handheld" | "till", patch: { columns: number }) => {
          Object.assign(home[device], patch);
        },
      );
      const api = {
        listCatalogues: async () => [{ id: "menu", name: "Carta", active: true, version: 1 }],
        listLibraryProducts: async () => [],
        listCategories: async () => [],
        getCatalogueSettings: async () => ({
          defaultProductVatClass: "general",
          defaultColor: null,
        }),
        getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "en"] }),
        getMenuStructure: async () => structure,
        getMenuHome: async () => home,
        getMenuStatus: async () => preview.status,
        getMenuPreview: async () => preview,
        getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
        getMenuRead: async (_id: string, parts: MenuReadPart[]): Promise<MenuReadResult> => {
          const bodies = { structure, home, preview, status: preview.status };
          return Object.fromEntries(
            parts.map((part) => [part, { status: 200, body: bodies[part] }]),
          );
        },
        setHomeDisplay,
      } as unknown as DashboardApi;
      history.replaceState(null, "", "/manage/menus/menu/menu/view/home");
      const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api });
      const slider = () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-slider"]>(
          'wt-slider[name="home-columns"]',
        )!;
      await vi.waitFor(() => expect(slider()).not.toBeNull());
      await slider().updateComplete;
      const native = () =>
        slider().shadowRoot!.querySelector<HTMLInputElement>('input[type="range"]')!;
      expect([native().min, native().max, native().value]).toEqual(["2", "3", "2"]);
      native().value = "4";
      expect(native().value).toBe("3");
      native().dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() =>
        expect(setHomeDisplay).toHaveBeenLastCalledWith("menu", "handheld", { columns: 3 }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLInputElement>(
        'input[name="home-device"][value="till"]',
      )!.click();
      await el.updateComplete;
      await slider().updateComplete;
      expect([native().min, native().max, native().value]).toEqual(["4", "10", "6"]);
      native().value = "3";
      expect(native().value).toBe("4");
      native().dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() =>
        expect(setHomeDisplay).toHaveBeenLastCalledWith("menu", "till", { columns: 4 }),
      );
    } finally {
      setLocale(before);
    }
  },
);
