import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  DashboardApi,
  MenuChange,
  MenuHome,
  MenuPreview,
  MenuReadPart,
  MenuReadResult,
  MenuStatus,
  MenuStructure,
} from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  documentSection,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import type { MenuPreviewPanel } from "../widgets/menu-preview.js";
import { MenusScreen } from "./menus-screen.js";

const locale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale(locale);
  cleanupWidgets();
});

const MENU = "menu-lunch";
const status: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: "2026-09-26T10:15:00.000Z",
  hash: "a".repeat(64),
};

const rename: MenuChange = {
  id: "own-rename",
  targets: { before: [], after: [] },
  kind: "menu_renamed",
  from: "Lunch",
  to: "Lunch Menu",
  source: "this_menu",
};
const recolour: MenuChange = {
  id: "mains-colour",
  targets: { before: [], after: [] },
  kind: "section_changed",
  sectionId: "s-mains",
  name: "Mains",
  fields: ["color"],
  source: "this_menu",
};

const mains = (color: string | null) => {
  const node = documentSection("s-mains", "Mains", []);
  return node.kind === "section" ? { ...node, color } : node;
};

function previewOf(changes: MenuChange[]): MenuPreview {
  return {
    live: { versionId: "v-2", document: menuDocument([mains(null)], {}, "Lunch") },
    clashes: [],
    hash: "b".repeat(64),
    changes,
    warnings: [],
    status,
    document: menuDocument([mains("#ff0000")], {}),
  };
}

const structure: MenuStructure = {
  rootSectionId: "root",
  root: {
    id: "root",
    internalName: "Lunch Menu",
    names: {},
    image: null,
    color: null,
    members: [],
  },
  nodes: [],
  includable: [],
  includedBy: [],
};

/** A fake API whose preview read answers `state.preview`, or fails while `state.readFails`. */
function fakeApi(writes: Partial<DashboardApi>) {
  const state = {
    preview: previewOf([rename, recolour]),
    readFails: false,
    menuName: "Lunch Menu",
  };
  const home = {} as MenuHome;
  const listCatalogues = vi.fn(async () => [
    { id: MENU, name: state.menuName, active: true, version: 2 },
  ]);
  const getMenuRead = vi.fn(async (_id: string, parts: MenuReadPart[]): Promise<MenuReadResult> =>
    Object.fromEntries(
      parts.map((part) => {
        if (part === "preview" && state.readFails)
          return [part, { status: 409, body: { error: { code: "menu.read_failed" } } }];
        const bodies = { structure, home, preview: state.preview, status };
        return [part, { status: 200, body: bodies[part] }];
      }),
    ),
  );
  const api = {
    listCatalogues,
    listLibraryProducts: async () => [],
    listCategories: async () => [],
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuStructure: async () => structure,
    getMenuHome: async () => home,
    getMenuStatus: async () => status,
    getMenuPreview: async () => state.preview,
    getMenuStatuses: async () => ({ [MENU]: status }),
    getMenuRead,
    ...writes,
  } as unknown as DashboardApi;
  return { api, state, listCatalogues, getMenuRead };
}

async function mount(api: DashboardApi) {
  history.replaceState(null, "", `/manage/menus/menu/${MENU}/view/preview`);
  const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api });
  const panel = () => el.shadowRoot!.querySelector<MenuPreviewPanel>("dashboard-menu-preview")!;
  await vi.waitFor(() =>
    expect(panel()?.shadowRoot?.querySelector('[data-change-row="own-rename"]')).not.toBeNull(),
  );
  return { el, panel };
}

const undoButton = (panel: MenuPreviewPanel, id: string) =>
  panel.shadowRoot!.querySelector<HTMLButtonElement>(`button.undo[data-undo-change="${id}"]`);
const words = (panel: MenuPreviewPanel, id: string) =>
  (panel.shadowRoot!.querySelector(`[data-change-row="${id}"] > span`)?.textContent ?? "").trim();
const resultLine = (panel: MenuPreviewPanel) =>
  panel.shadowRoot!.querySelector('[data-test="undo-result"]');
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

it("undoes a rename with the live name, previews again, says what was undone and reads the menus again", async () => {
  let fake!: ReturnType<typeof fakeApi>;
  const renameCatalogue = vi.fn(async (_id: string, name: string) => {
    fake.state.menuName = name;
    fake.state.preview = previewOf([recolour]);
  });
  fake = fakeApi({ renameCatalogue } as Partial<DashboardApi>);
  const { panel } = await mount(fake.api);
  const bullet = words(panel(), "own-rename");
  const menuReads = fake.listCatalogues.mock.calls.length;
  await userEvent.click(undoButton(panel(), "own-rename")!);
  await vi.waitFor(() =>
    expect(panel().shadowRoot!.querySelector('[data-change-row="own-rename"]')).toBeNull(),
  );
  expect(renameCatalogue.mock.calls).toEqual([[MENU, "Lunch"]]);
  await vi.waitFor(() => expect(text(resultLine(panel()))).toBe(`Undone: ${bullet}.`));
  expect(fake.listCatalogues.mock.calls.length).toBeGreaterThan(menuReads);
  expect(undoButton(panel(), "mains-colour")!.getAttribute("aria-disabled")).toBeNull();
});

it("keeps a refused change listed with its sentence beside it, and says nothing was undone", async () => {
  const updateSection = vi.fn(async () => {
    throw { code: "menu_section.invalid", params: { field: "color" } };
  });
  const fake = fakeApi({ updateSection } as Partial<DashboardApi>);
  const { panel } = await mount(fake.api);
  await userEvent.click(undoButton(panel(), "mains-colour")!);
  await vi.waitFor(() =>
    expect(text(panel().shadowRoot!.querySelector("[data-undo-refusal]"))).toBe(
      "Not undone. Mains's published photo or colour can no longer be used. Change it on the Structure tab, or hide this change.",
    ),
  );
  expect(updateSection.mock.calls).toEqual([["s-mains", { color: null }]]);
  expect(
    panel().shadowRoot!.querySelector('[data-change-row="mains-colour"] [data-undo-refusal]'),
  ).not.toBeNull();
  expect(resultLine(panel())).toBeNull();
  expect(undoButton(panel(), "mains-colour")!.getAttribute("aria-disabled")).toBeNull();
});

it("reports a failed read after a stored Undo as a load failure, keeping the success line", async () => {
  let fake!: ReturnType<typeof fakeApi>;
  const renameCatalogue = vi.fn(async () => {
    fake.state.readFails = true;
  });
  fake = fakeApi({ renameCatalogue } as Partial<DashboardApi>);
  const { el, panel } = await mount(fake.api);
  const bullet = words(panel(), "own-rename");
  await userEvent.click(undoButton(panel(), "own-rename")!);
  await vi.waitFor(() => expect(panel().failed).toBe(true));
  await panel().updateComplete;
  expect(text(resultLine(panel()))).toBe(`Undone: ${bullet}.`);
  expect(panel().shadowRoot!.querySelector("[data-undo-refusal]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("not saved");
  expect(el.shadowRoot!.textContent).not.toContain("Not undone");
});

it("sends one write for two quick clicks", async () => {
  let answer!: () => void;
  const renameCatalogue = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
  );
  const fake = fakeApi({ renameCatalogue } as Partial<DashboardApi>);
  const { panel } = await mount(fake.api);
  const button = undoButton(panel(), "own-rename")!;
  // Both clicks land before the Preview redraws, so only the screen can refuse the second.
  button.click();
  button.click();
  await vi.waitFor(() => expect(renameCatalogue).toHaveBeenCalledTimes(1));
  answer();
  await vi.waitFor(() => expect(text(resultLine(panel()))).toContain("Undone"));
  expect(renameCatalogue).toHaveBeenCalledTimes(1);
});
