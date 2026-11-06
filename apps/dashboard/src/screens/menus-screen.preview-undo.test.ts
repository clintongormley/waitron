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
const DINNER = "menu-dinner";
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
    { id: DINNER, name: "Dinner", active: true, version: 1 },
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
const publishButton = (panel: MenuPreviewPanel) =>
  panel.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>('[data-test="publish"]')!;
const heading = (el: MenusScreen) => text(el.shadowRoot!.querySelector("h1"));
const memberError = (el: MenusScreen) =>
  text(el.shadowRoot!.querySelector('[data-test="member-error"]'));

/** A write that answers only when the test says so. */
function held<T = void>() {
  let answer!: (value: T) => void;
  let refuse!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  return { promise, answer, refuse };
}

/** Goes to another address the way the browser's Back and Forward do. */
function visit(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Asks for an Undo the way the Preview does, whatever the Preview would draw. */
function askUndo(panel: MenuPreviewPanel, changeId: string): void {
  panel.dispatchEvent(
    new CustomEvent("wt-menu-undo", {
      detail: { changeId, change: words(panel, changeId) },
      bubbles: true,
      composed: true,
    }),
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

it("undoes a rename with the live name, previews again, says what was undone and reads the menus again", async () => {
  const renameCatalogue = vi.fn(async (_id: string, name: string) => {
    fake.state.menuName = name;
    fake.state.preview = previewOf([recolour]);
  });
  const fake = fakeApi({ renameCatalogue } as Partial<DashboardApi>);
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
  const renameCatalogue = vi.fn(async () => {
    fake.state.readFails = true;
  });
  const fake = fakeApi({ renameCatalogue } as Partial<DashboardApi>);
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

it("names a refused Undo beside the list as not undone once the person has left the Preview", async () => {
  const write = held();
  const updateSection = vi.fn(() => write.promise);
  const fake = fakeApi({ updateSection } as unknown as Partial<DashboardApi>);
  const { el, panel } = await mount(fake.api);
  const bullet = words(panel(), "mains-colour");
  await userEvent.click(undoButton(panel(), "mains-colour")!);
  await vi.waitFor(() => expect(updateSection).toHaveBeenCalledTimes(1));
  visit(`/manage/menus/menu/${MENU}/view/structure`);
  const tabs = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
    '[data-test="menu-tabs"]',
  )!;
  await vi.waitFor(() => expect(tabs.value).toBe("structure"));
  write.refuse({ code: "menu_section.invalid", params: { field: "color" } });
  await vi.waitFor(() =>
    expect(memberError(el)).toBe(
      `${bullet}: not undone. Mains's published photo or colour can no longer be used. Change it on the Structure tab, or hide this change.`,
    ),
  );
  expect(memberError(el)).not.toContain("not saved");
});

it("sends no publish of a menu whose Undo is still out after another menu was opened and this one reopened", async () => {
  const write = held();
  const updateSection = vi.fn(() => write.promise);
  const publishMenu = vi.fn(async () => ({ number: 3 }));
  const fake = fakeApi({ updateSection, publishMenu } as unknown as Partial<DashboardApi>);
  const { el, panel } = await mount(fake.api);
  await userEvent.click(undoButton(panel(), "mains-colour")!);
  await vi.waitFor(() => expect(updateSection).toHaveBeenCalledTimes(1));

  visit(`/manage/menus/menu/${DINNER}/view/preview`);
  await vi.waitFor(() => expect(heading(el)).toBe("Dinner"));
  await vi.waitFor(() => expect(undoButton(panel(), "mains-colour")).not.toBeNull());
  // The other menu lists a change with the same id; it is not the one being undone.
  expect(text(undoButton(panel(), "mains-colour"))).toBe("Undo");

  visit(`/manage/menus/menu/${MENU}/view/preview`);
  await vi.waitFor(() => expect(heading(el)).toBe("Lunch Menu"));
  await vi.waitFor(() => expect(text(undoButton(panel(), "mains-colour"))).toBe("Undoing…"));
  expect(publishButton(panel()).disabled).toBe(true);
  panel().dispatchEvent(
    new CustomEvent("wt-menu-publish", {
      detail: { hash: "b".repeat(64) },
      bubbles: true,
      composed: true,
    }),
  );
  await settle();
  expect(publishMenu).not.toHaveBeenCalled();

  write.answer();
  await vi.waitFor(() => expect(text(resultLine(panel()))).toContain("Undone"));
});

it("sends no Undo while a publish of this menu is out", async () => {
  const publishing = held<{ number: number }>();
  const publishMenu = vi.fn(() => publishing.promise);
  const updateSection = vi.fn(async () => {});
  const fake = fakeApi({ updateSection, publishMenu } as unknown as Partial<DashboardApi>);
  const { panel } = await mount(fake.api);
  publishButton(panel()).click();
  await vi.waitFor(() => expect(publishMenu).toHaveBeenCalledTimes(1));
  askUndo(panel(), "mains-colour");
  await settle();
  expect(updateSection).not.toHaveBeenCalled();
  publishing.answer({ number: 3 });
  await vi.waitFor(() => expect(panel().publishing).toBe(false));
});

it("sends no Undo while the preview's read has failed", async () => {
  const renameCatalogue = vi.fn(async () => {
    fake.state.readFails = true;
  });
  const updateSection = vi.fn(async () => {});
  const fake = fakeApi({ renameCatalogue, updateSection } as unknown as Partial<DashboardApi>);
  const { panel } = await mount(fake.api);
  const recolourWords = words(panel(), "mains-colour");
  await userEvent.click(undoButton(panel(), "own-rename")!);
  await vi.waitFor(() => expect(panel().failed).toBe(true));
  await vi.waitFor(() => expect(panel().undoBlocked).toBe(false));
  expect(panel().undoing).toBeNull();
  panel().dispatchEvent(
    new CustomEvent("wt-menu-undo", {
      detail: { changeId: "mains-colour", change: recolourWords },
      bubbles: true,
      composed: true,
    }),
  );
  await settle();
  expect(updateSection).not.toHaveBeenCalled();
});
