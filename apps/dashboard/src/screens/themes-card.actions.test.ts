import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  WtButton,
  WtDeleteDialog,
  WtDialog,
  WtInput,
  WtRowActions,
  WtSwitch,
} from "@waitron/ui";
import { createLeaveCoordinator } from "@waitron/ui-core/unsaved-changes";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  dialogClosed,
  dialogMessageOf,
  mountWidget,
} from "../widgets/test-helpers.js";
import type { ThemeSwitchDialog } from "../widgets/theme-switch-dialog.js";
import type { ThemesChanged } from "./themes-card.js";
import "./themes-card.js";

type Card = HTMLElementTagNameMap["dashboard-themes-card"];
type Table = HTMLElementTagNameMap["wt-data-table"];

function theme(id: string, name: string, choices: ThemeChoices): ThemeView {
  const derived = deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived.light,
    dark: derived.dark,
    warnings: derived.warnings,
  };
}

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  logo: null,
  handSet: { light: {}, dark: {} },
  textScale: 100,
  text: {},
};
const lucia = theme("t-lucia", "Bar Lucía", LUCIA);
const xmas = theme("t-xmas", "Christmas", {
  ...WAITRON_CHOICES,
  brandColor: "#7a1f2b",
  brandFix: { dark: true },
});
/** `#2a6fb0` warns on dark screens only. */
const summer = theme("t-summer", "Summer terrace", { ...WAITRON_CHOICES, brandColor: "#2a6fb0" });
const four: ThemeList = { themes: [lucia, xmas, summer], inUse: "t-lucia" };

const ITEMS = ["use", "edit", "rename", "copy", "delete"] as const;

function stubApi() {
  const createTheme = vi.fn<DashboardApi["createTheme"]>(async ({ name, theme: choices }) =>
    theme("t-new", name, choices),
  );
  const renameTheme = vi.fn<DashboardApi["renameTheme"]>(async (id, name) => ({
    ...xmas,
    id,
    name,
  }));
  const getVenueTheme = vi.fn(async () => ({ hash: "h2", css: "", logo: null }));
  const useTheme = vi.fn<DashboardApi["useTheme"]>(async (id) => ({ inUse: id }));
  const deleteTheme = vi.fn<DashboardApi["deleteTheme"]>(async () => ({ inUse: null }));
  const api = {
    createTheme,
    renameTheme,
    getVenueTheme,
    useTheme,
    deleteTheme,
  } as unknown as DashboardApi;
  return { api, createTheme, renameTheme, getVenueTheme, useTheme, deleteTheme };
}

async function mount(list: ThemeList, extra: Partial<Card> = {}) {
  const stub = stubApi();
  const { el } = await mountWidget<Card>("dashboard-themes-card", {
    api: stub.api,
    list,
    canEdit: true,
    ...extra,
  });
  await table(el).updateComplete;
  const changes: ThemesChanged[] = [];
  const edits: unknown[] = [];
  el.addEventListener("themes-changed", (event) =>
    changes.push((event as CustomEvent<ThemesChanged>).detail),
  );
  el.addEventListener("theme-edit", (event) => edits.push((event as CustomEvent).detail));
  return { el, changes, edits, ...stub };
}

const table = (el: Card) => el.shadowRoot!.querySelector("wt-data-table") as Table;
const menu = (el: Card, key: string) =>
  table(el).shadowRoot!.querySelector(`tr[data-row-key="${key}"] wt-row-actions`) as HTMLElement;

async function openMenu(el: Card, key: string): Promise<HTMLElement> {
  for (const open of table(el).shadowRoot!.querySelectorAll<WtRowActions>("wt-row-actions")) {
    open.hide();
  }
  const actions = menu(el, key);
  await userEvent.click(actions.shadowRoot!.querySelector("button")!);
  return actions;
}

/** The menu's items, by the kind its `data-test` names. */
function itemsOf(actions: HTMLElement, key: string): Record<string, WtButton> {
  const found: Record<string, WtButton> = {};
  for (const item of ITEMS) {
    const button = actions.querySelector<WtButton>(`[data-test="${item}-${key}"]`);
    if (button) found[item] = button;
  }
  return found;
}

async function choose(el: Card, key: string, item: (typeof ITEMS)[number]): Promise<void> {
  const actions = await openMenu(el, key);
  await userEvent.click(actions.querySelector<HTMLElement>(`[data-test="${item}-${key}"]`)!);
  await el.updateComplete;
}

async function nameDialog(el: Card): Promise<WtDialog> {
  const host = el.shadowRoot!.querySelector("dashboard-theme-name-dialog")!;
  await (host as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog[data-test=name-dialog]")!;
  await expect.poll(() => dialog.open).toBe(true);
  return dialog;
}

const input = (dialog: WtDialog) => dialog.querySelector<WtInput>("wt-input[name=name]")!;
const toggle = (dialog: WtDialog) => dialog.querySelector<WtSwitch>("wt-switch[name=inUse]");
const save = (dialog: WtDialog) =>
  dialog.querySelector<WtButton>("wt-button[data-test=name-save]")!;

async function settle(el: Card): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function type(el: Card, dialog: WtDialog, value: string): Promise<void> {
  input(dialog).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}

async function flip(el: Card, dialog: WtDialog, checked: boolean): Promise<void> {
  toggle(dialog)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await settle(el);
}

const switchHost = (el: Card) =>
  el.shadowRoot!.querySelector<ThemeSwitchDialog>("dashboard-theme-switch-dialog");
const deleteHost = (el: Card) => el.shadowRoot!.querySelector<WtDeleteDialog>("wt-delete-dialog");

async function switchDialog(el: Card): Promise<WtDialog> {
  const host = switchHost(el)!;
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  return dialog;
}

const switchButton = (dialog: WtDialog, which: "use" | "back") =>
  dialog.querySelector<WtButton>(`wt-button[data-test=switch-${which}]`)!;

async function deleteDialog(el: Card): Promise<WtDeleteDialog> {
  const host = deleteHost(el)!;
  await expect.poll(() => host.open).toBe(true);
  await host.updateComplete;
  return host;
}

const confirmDelete = (dialog: WtDeleteDialog) =>
  dialog.shadowRoot!.querySelector<WtButton>("wt-button[data-test=delete-confirm]")!;

/** The lines of the dialog's "What changes" group, or [] when it is not drawn. */
const endsOf = (dialog: WtDeleteDialog) =>
  [...dialog.shadowRoot!.querySelectorAll("[data-group=ends] li")].map((li) => li.textContent);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("dashboard-themes-card actions", () => {
  it("each kind of row offers its own items", async () => {
    setLocale("en-GB");
    const { el } = await mount(four);
    const luciaItems = itemsOf(await openMenu(el, "t-lucia"), "t-lucia");
    expect(Object.keys(luciaItems)).toEqual(["edit", "rename", "copy", "delete"]);
    expect(Object.values(luciaItems).map((item) => item.textContent!.trim())).toEqual([
      "Edit",
      "Rename",
      "Make a copy",
      "Delete",
    ]);
    const xmasItems = itemsOf(await openMenu(el, "t-xmas"), "t-xmas");
    expect(Object.keys(xmasItems)).toEqual(["use", "edit", "rename", "copy", "delete"]);
    expect(xmasItems.use!.textContent!.trim()).toBe("Use on every screen");
    for (const [kind, item] of Object.entries(xmasItems)) {
      expect(item.getAttribute("variant")).toBe(kind === "delete" ? "danger" : "ghost");
      expect(item.getAttribute("align")).toBe("start");
    }
    expect(Object.keys(itemsOf(await openMenu(el, "waitron"), "waitron"))).toEqual(["use", "copy"]);

    cleanupWidgets();
    const inUse = await mount({ ...four, inUse: null });
    expect(Object.keys(itemsOf(await openMenu(inUse.el, "waitron"), "waitron"))).toEqual(["copy"]);
  });

  it("the theme being edited offers no Delete", async () => {
    const { el } = await mount(four, { editingId: "t-xmas" });
    const xmasMenu = await openMenu(el, "t-xmas");
    expect(xmasMenu.querySelector("[data-test=delete-t-xmas]")).toBeNull();
    expect(xmasMenu.querySelector("[data-test=edit-t-xmas]")).not.toBeNull();
    expect(
      (await openMenu(el, "t-lucia")).querySelector("[data-test=delete-t-lucia]"),
    ).not.toBeNull();
    el.editingId = null;
    await el.updateComplete;
    await table(el).updateComplete;
    expect(menu(el, "t-xmas").querySelector("[data-test=delete-t-xmas]")).not.toBeNull();
  });

  it("Edit and Add theme ask the page to open the editor", async () => {
    const { el, edits, createTheme, renameTheme, getVenueTheme } = await mount(four);
    await choose(el, "t-xmas", "edit");
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-theme]")!);
    expect(edits).toEqual([{ id: "t-xmas" }, { kind: "new" }]);
    expect(createTheme).not.toHaveBeenCalled();
    expect(renameTheme).not.toHaveBeenCalled();
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("Make a copy names Christmas and stores a copy not in use", async () => {
    const { el, changes, createTheme, getVenueTheme } = await mount(four);
    await choose(el, "t-lucia", "copy");
    const dialog = await nameDialog(el);
    expect(input(dialog).value).toBe("Bar Lucía (copy)");
    expect(toggle(dialog)!.checked).toBe(false);
    await type(el, dialog, "Christmas");
    const closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(createTheme).toHaveBeenCalledWith({ name: "Christmas", theme: LUCIA, inUse: false });
    expect(changes).toEqual([
      { kind: "created", theme: theme("t-new", "Christmas", LUCIA), inUse: false },
    ]);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("Make a copy of Waitron's sends Waitron's choices", async () => {
    const unreadable: ThemeView = {
      ...xmas,
      id: "t-old",
      name: "Old",
      choices: null,
      light: null,
      dark: null,
      warnings: [],
    };
    const { el, createTheme } = await mount({ themes: [unreadable], inUse: null });
    await choose(el, "waitron", "copy");
    let dialog = await nameDialog(el);
    expect(input(dialog).value).toBe("Waitron (copy)");
    let closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    expect(createTheme).toHaveBeenLastCalledWith({
      name: "Waitron (copy)",
      theme: WAITRON_CHOICES,
      inUse: false,
    });

    await choose(el, "t-old", "copy");
    dialog = await nameDialog(el);
    expect(input(dialog).value).toBe("Old (copy)");
    closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    expect(createTheme).toHaveBeenLastCalledWith({
      name: "Old (copy)",
      theme: WAITRON_CHOICES,
      inUse: false,
    });
    expect(createTheme).toHaveBeenCalledTimes(2);
  });

  it("a copy put in use lists its warnings, then repaints this dashboard", async () => {
    const { el, changes, createTheme, getVenueTheme } = await mount(four);
    let answer!: (view: ThemeView) => void;
    createTheme.mockImplementationOnce(
      () => new Promise<ThemeView>((resolve) => (answer = resolve)),
    );
    await choose(el, "t-summer", "copy");
    const dialog = await nameDialog(el);
    expect(dialog.querySelector("[data-test=name-warnings]")).toBeNull();
    await flip(el, dialog, true);
    const warnings = dialog.querySelector("[data-test=name-warnings]")!;
    expect(warnings.querySelector("p")!.textContent).toBe("Hard to read:");
    expect([...warnings.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Brand colour: buttons are hard to see on dark screens.",
    ]);
    const closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    expect(createTheme).toHaveBeenCalledWith({
      name: "Summer terrace (copy)",
      theme: summer.choices,
      inUse: true,
    });
    await settle(el);
    expect(getVenueTheme).not.toHaveBeenCalled();
    await table(el).updateComplete;
    expect(menu(el, "t-xmas").querySelector<WtButton>("[data-test=copy-t-xmas]")!.disabled).toBe(
      true,
    );
    const created = theme("t-new", "Summer terrace (copy)", summer.choices!);
    answer(created);
    await closed;
    await expect.poll(() => getVenueTheme.mock.calls.length).toBe(1);
    await table(el).updateComplete;
    expect(menu(el, "t-xmas").querySelector<WtButton>("[data-test=copy-t-xmas]")!.disabled).toBe(
      false,
    );
    expect(changes).toEqual([{ kind: "created", theme: created, inUse: true }]);
  });

  it("a second copy's taken name is refused under the field", async () => {
    const { el, createTheme, changes } = await mount(four);
    createTheme.mockRejectedValueOnce({
      code: "theme.name_taken",
      params: { field: "name" },
    });
    await choose(el, "t-xmas", "copy");
    const dialog = await nameDialog(el);
    await userEvent.click(save(dialog));
    await settle(el);
    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(input(dialog).error).toBe("A theme with this name already exists.");
    expect(save(dialog).disabled).toBe(false);
    expect(changes).toEqual([]);
  });

  it("the row menus are usable again after a refused request", async () => {
    const { el, renameTheme } = await mount(four);
    renameTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await choose(el, "t-xmas", "rename");
    const dialog = await nameDialog(el);
    await type(el, dialog, "Holiday");
    await userEvent.click(save(dialog));
    await settle(el);
    expect(renameTheme).toHaveBeenCalledTimes(1);
    await table(el).updateComplete;
    for (const item of ["edit", "rename", "copy", "delete"]) {
      expect(
        menu(el, "t-lucia").querySelector<WtButton>(`[data-test=${item}-t-lucia]`)!.disabled,
      ).toBe(false);
    }
  });

  it("Rename changes only the name", async () => {
    const { el, changes, renameTheme, getVenueTheme } = await mount(four);
    await choose(el, "t-xmas", "rename");
    const dialog = await nameDialog(el);
    expect(toggle(dialog)).toBeNull();
    expect(input(dialog).value).toBe("Christmas");
    await type(el, dialog, "Holiday");
    const closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    expect(renameTheme).toHaveBeenCalledTimes(1);
    expect(renameTheme).toHaveBeenCalledWith("t-xmas", "Holiday");
    expect(changes).toEqual([{ kind: "renamed", theme: { ...xmas, name: "Holiday" } }]);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("a rename of a theme deleted elsewhere says so", async () => {
    const { el, changes, renameTheme } = await mount(four);
    renameTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await choose(el, "t-xmas", "rename");
    const dialog = await nameDialog(el);
    await type(el, dialog, "Holiday");
    await userEvent.click(save(dialog));
    await settle(el);
    expect(dialog.open).toBe(true);
    expect(await dialogMessageOf(dialog)).toBe(codeMessage("theme.not_found"));
    expect(codeMessage("theme.not_found")).toBe("This theme no longer exists.");
    expect(save(dialog).disabled).toBe(false);
    expect(changes).toEqual([]);
  });

  it("a theme with a text warning counts it and the switch dialog lists it", async () => {
    setLocale("en-GB");
    const small = theme("t-small", "Small text", {
      ...WAITRON_CHOICES,
      text: { size: { sm: 10 } },
    });
    const { el } = await mount({ themes: [lucia, small], inUse: "t-lucia" });
    const tag = table(el).shadowRoot!.querySelector(
      'tr[data-row-key="t-small"] [data-test=tag-hard-to-read]',
    );
    expect(tag?.textContent?.replace(/\s+/g, " ").trim()).toBe("1 hard to read");
    await choose(el, "t-small", "use");
    const dialog = await switchDialog(el);
    expect([...dialog.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      fill("appearance.text_too_small", { name: "Small text", size: "10" }),
    ]);
    const closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "back"));
    await closed;
  });

  it("Use on every screen asks once, then switches", async () => {
    const { el, changes, useTheme, getVenueTheme } = await mount(four);
    await choose(el, "t-xmas", "use");
    let dialog = await switchDialog(el);
    expect(dialog.heading).toBe("Use Christmas on every screen?");
    expect(dialog.querySelectorAll("li")).toHaveLength(0);
    let closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "back"));
    await closed;
    expect(useTheme).not.toHaveBeenCalled();

    await choose(el, "t-xmas", "use");
    dialog = await switchDialog(el);
    closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "use"));
    await closed;
    expect(useTheme).toHaveBeenCalledTimes(1);
    expect(useTheme).toHaveBeenCalledWith("t-xmas");
    expect(changes).toEqual([{ kind: "switched", inUse: "t-xmas" }]);
    await expect.poll(() => getVenueTheme.mock.calls.length).toBe(1);

    await choose(el, "t-summer", "use");
    dialog = await switchDialog(el);
    expect(dialog.heading).toBe("Use Summer terrace on every screen?");
    expect([...dialog.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Brand colour: buttons are hard to see on dark screens.",
    ]);
    closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "back"));
    await closed;

    await choose(el, "waitron", "use");
    dialog = await switchDialog(el);
    expect(dialog.heading).toBe("Use Waitron on every screen?");
    closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "use"));
    await closed;
    expect(useTheme).toHaveBeenLastCalledWith(null);
    expect(useTheme).toHaveBeenCalledTimes(2);
  });

  it("the switch dialog says nothing about text size between themes of different sizes", async () => {
    const large = theme("t-large", "Large", { ...LUCIA, textScale: 120 });
    const larger = theme("t-larger", "Larger too", { ...LUCIA, textScale: 120 });
    const largest = theme("t-largest", "Largest", { ...LUCIA, textScale: 130 });
    const unread: ThemeView = {
      ...lucia,
      id: "t-unread",
      name: "Unread",
      choices: null,
      light: null,
      dark: null,
      warnings: [],
    };
    const themes = [lucia, large, larger, largest, unread];
    const noteFor = async (el: Card, key: string) => {
      await choose(el, key, "use");
      const dialog = await switchDialog(el);
      const note =
        [...dialog.querySelectorAll("p")].find((p) => p.textContent?.includes("changes size"))
          ?.textContent ?? null;
      const closed = dialogClosed(dialog);
      await userEvent.click(switchButton(dialog, "back"));
      await closed;
      return note;
    };
    const fromLarge = (await mount({ themes, inUse: "t-large" })).el;
    expect(await noteFor(fromLarge, "t-lucia")).toBeNull();
    expect(await noteFor(fromLarge, "t-larger")).toBeNull();
    expect(await noteFor(fromLarge, "t-unread")).toBeNull();
    expect(await noteFor(fromLarge, "waitron")).toBeNull();
    cleanupWidgets();

    const fromWaitron = (await mount({ themes, inUse: null })).el;
    expect(await noteFor(fromWaitron, "t-lucia")).toBeNull();
    expect(await noteFor(fromWaitron, "t-largest")).toBeNull();
    expect(await noteFor(fromWaitron, "t-unread")).toBeNull();
    cleanupWidgets();

    const fromUnread = (await mount({ themes, inUse: "t-unread" })).el;
    expect(await noteFor(fromUnread, "t-lucia")).toBeNull();
    expect(await noteFor(fromUnread, "t-large")).toBeNull();
  });

  it("a switch to a theme deleted elsewhere says so", async () => {
    const { el, changes, useTheme, getVenueTheme } = await mount(four);
    useTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await choose(el, "t-xmas", "use");
    const dialog = await switchDialog(el);
    await userEvent.click(switchButton(dialog, "use"));
    await settle(el);
    await switchHost(el)!.updateComplete;
    expect(useTheme).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(await dialogMessageOf(dialog)).toBe(codeMessage("theme.not_found"));
    expect(switchButton(dialog, "use").disabled).toBe(false);
    expect(changes).toEqual([]);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("Delete asks with the shared dialog, naming the theme in use", async () => {
    const { el, changes, deleteTheme, getVenueTheme } = await mount(four);
    await choose(el, "t-lucia", "delete");
    let dialog = await deleteDialog(el);
    expect(dialog.shadowRoot!.querySelector("[data-target]")!.textContent).toBe("Bar Lucía");
    expect(endsOf(dialog)).toEqual([
      "Bar Lucía is in use on every screen. Deleting it puts Waitron's theme on every screen.",
    ]);
    await userEvent.click(confirmDelete(dialog));
    expect(deleteTheme).toHaveBeenCalledTimes(1);
    expect(deleteTheme).toHaveBeenCalledWith("t-lucia");
    await expect.poll(() => dialog.open).toBe(false);
    expect(changes).toEqual([{ kind: "deleted", id: "t-lucia", inUse: null }]);
    await expect.poll(() => getVenueTheme.mock.calls.length).toBe(1);

    deleteTheme.mockResolvedValueOnce({ inUse: "t-lucia" });
    await choose(el, "t-xmas", "delete");
    dialog = await deleteDialog(el);
    expect(dialog.shadowRoot!.querySelector("[data-target]")!.textContent).toBe("Christmas");
    expect(endsOf(dialog)).toEqual([]);
    await userEvent.click(confirmDelete(dialog));
    await expect.poll(() => dialog.open).toBe(false);
    expect(deleteTheme).toHaveBeenLastCalledWith("t-xmas");
    expect(changes.at(-1)).toEqual({ kind: "deleted", id: "t-xmas", inUse: "t-lucia" });
    await settle(el);
    expect(getVenueTheme).toHaveBeenCalledTimes(1);
  });

  it("the delete dialog follows the live list", async () => {
    const { el } = await mount(four);
    await choose(el, "t-xmas", "delete");
    const dialog = await deleteDialog(el);
    expect(endsOf(dialog)).toEqual([]);
    el.list = { ...four, inUse: "t-xmas" };
    await el.updateComplete;
    await dialog.updateComplete;
    expect(endsOf(dialog)).toEqual([
      "Christmas is in use on every screen. Deleting it puts Waitron's theme on every screen.",
    ]);
  });

  it("a refused delete keeps the dialog usable", async () => {
    const { el, changes, deleteTheme } = await mount(four);
    deleteTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await choose(el, "t-xmas", "delete");
    const dialog = await deleteDialog(el);
    await userEvent.click(confirmDelete(dialog));
    await settle(el);
    await dialog.updateComplete;
    expect(deleteTheme).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(dialog.actionError).toBe(codeMessage("theme.not_found"));
    expect(confirmDelete(dialog).disabled).toBe(false);
    expect(changes).toEqual([]);
  });

  it("a double press sends once", async () => {
    const { el, useTheme, deleteTheme } = await mount(four);
    useTheme.mockImplementationOnce(() => new Promise(() => {}));
    await choose(el, "t-xmas", "use");
    await switchDialog(el);
    const confirm = () =>
      new CustomEvent("theme-switch-confirm", { bubbles: true, composed: true });
    switchHost(el)!.dispatchEvent(confirm());
    switchHost(el)!.dispatchEvent(confirm());
    expect(useTheme).toHaveBeenCalledTimes(1);

    cleanupWidgets();
    const second = await mount(four);
    second.deleteTheme.mockImplementationOnce(() => new Promise(() => {}));
    await choose(second.el, "t-summer", "delete");
    await deleteDialog(second.el);
    const press = () =>
      new CustomEvent("wt-delete-confirm", {
        detail: { id: "t-summer" },
        bubbles: true,
        composed: true,
      });
    deleteHost(second.el)!.dispatchEvent(press());
    deleteHost(second.el)!.dispatchEvent(press());
    expect(second.deleteTheme).toHaveBeenCalledTimes(1);
    expect(deleteTheme).not.toHaveBeenCalled();
  });

  it("losing the right to edit closes every dialog without a request", async () => {
    const { el, renameTheme, useTheme, deleteTheme, createTheme } = await mount(four);
    const ask = vi.fn(async () => "keep" as const);
    const coordinator = createLeaveCoordinator(ask, window);
    el.parentElement!.addEventListener("wt-leave-coordinator", (event) => {
      event.stopPropagation();
      (event as CustomEvent<{ accept(value: unknown): void }>).detail.accept(coordinator);
    });
    const lose = async () => {
      el.canEdit = false;
      await el.updateComplete;
      await table(el).updateComplete;
      await settle(el);
    };
    const regain = async () => {
      el.canEdit = true;
      await el.updateComplete;
      await table(el).updateComplete;
      await settle(el);
    };

    await choose(el, "t-xmas", "rename");
    const name = await nameDialog(el);
    await type(el, name, "Holiday");
    expect(coordinator.isDirty()).toBe(true);
    await lose();
    expect(el.shadowRoot!.querySelector("dashboard-theme-name-dialog")).toBeNull();
    expect(coordinator.isDirty()).toBe(false);
    expect(table(el).columns.map((column) => column.key)).not.toContain("actions");
    expect(el.shadowRoot!.querySelector("[data-test=new-theme]")).toBeNull();
    await regain();
    const reopened = el.shadowRoot!.querySelector("dashboard-theme-name-dialog")!;
    await reopened.updateComplete;
    expect(reopened.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.open).toBe(false);

    await choose(el, "t-xmas", "use");
    await switchDialog(el);
    await lose();
    expect(switchHost(el)).toBeNull();
    await regain();
    await switchHost(el)!.updateComplete;
    expect(switchHost(el)!.open).toBe(false);

    await choose(el, "t-xmas", "delete");
    await deleteDialog(el);
    await lose();
    expect(deleteHost(el)).toBeNull();
    await regain();
    expect(deleteHost(el)!.open).toBe(false);

    expect(ask).not.toHaveBeenCalled();
    expect(renameTheme).not.toHaveBeenCalled();
    expect(useTheme).not.toHaveBeenCalled();
    expect(deleteTheme).not.toHaveBeenCalled();
    expect(createTheme).not.toHaveBeenCalled();
  });
});

describe("focus goes back to what opened each dialog", () => {
  function focused(): Element | null {
    let at = document.activeElement;
    while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
    return at;
  }
  const trigger = (el: Card, key: string) => menu(el, key).shadowRoot!.querySelector("button")!;
  const where = () => String(focused()?.outerHTML.slice(0, 80));

  /** The page hands each change back as a new list, as the Appearance screen does. */
  function follow(el: Card): void {
    el.addEventListener("themes-changed", (event) => {
      const change = (event as CustomEvent<ThemesChanged>).detail;
      const list = el.list!;
      if (change.kind === "renamed") {
        el.list = {
          ...list,
          themes: list.themes.map((view) => (view.id === change.theme.id ? change.theme : view)),
        };
      } else if (change.kind === "created") {
        el.list = { ...list, themes: [...list.themes, change.theme] };
      } else if (change.kind === "deleted") {
        el.list = {
          themes: list.themes.filter((view) => view.id !== change.id),
          inUse: change.inUse,
        };
      } else if (change.kind === "switched") {
        el.list = { ...list, inUse: change.inUse };
      }
    });
  }

  it("Rename's dialog hands focus back to the row's menu, after Back and after a save", async () => {
    const { el } = await mount(four);
    follow(el);
    await choose(el, "t-xmas", "rename");
    let dialog = await nameDialog(el);
    expect(dialog.opener).toBe(trigger(el, "t-xmas"));
    let closed = dialogClosed(dialog);
    await userEvent.click(dialog.querySelector<WtButton>("wt-button[data-test=name-back]")!);
    await closed;
    await expect.poll(focused, { message: where() }).toBe(trigger(el, "t-xmas"));

    await choose(el, "t-xmas", "rename");
    dialog = await nameDialog(el);
    await type(el, dialog, "Holiday");
    closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    await settle(el);
    await expect.poll(focused, { message: where() }).toBe(trigger(el, "t-xmas"));
  });

  it("Make a copy's dialog hands focus back to the row's menu", async () => {
    const { el } = await mount(four);
    follow(el);
    await choose(el, "t-xmas", "copy");
    const dialog = await nameDialog(el);
    expect(dialog.opener).toBe(trigger(el, "t-xmas"));
    const closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    await settle(el);
    await expect.poll(focused, { message: where() }).toBe(trigger(el, "t-xmas"));
  });

  it("the switch dialog hands focus back to the row's menu, after Back and after a switch", async () => {
    const { el } = await mount(four);
    follow(el);
    await choose(el, "t-xmas", "use");
    let dialog = await switchDialog(el);
    expect(switchHost(el)!.opener).toBe(trigger(el, "t-xmas"));
    let closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "back"));
    await closed;
    await expect.poll(focused, { message: where() }).toBe(trigger(el, "t-xmas"));

    await choose(el, "t-xmas", "use");
    dialog = await switchDialog(el);
    closed = dialogClosed(dialog);
    await userEvent.click(switchButton(dialog, "use"));
    await closed;
    await settle(el);
    await expect.poll(focused, { message: where() }).toBe(trigger(el, "t-xmas"));
  });

  it("the delete dialog hands focus back to the row's menu, and to Add theme once the row is gone", async () => {
    const { el } = await mount(four);
    follow(el);
    await choose(el, "t-xmas", "delete");
    let dialog = await deleteDialog(el);
    expect(dialog.opener).toBe(trigger(el, "t-xmas"));
    let closed = dialogClosed(dialog.shadowRoot!.querySelector("wt-modal")!);
    await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-test=delete-cancel]")!);
    await closed;
    await expect.poll(focused, { message: where() }).toBe(trigger(el, "t-xmas"));

    await choose(el, "t-xmas", "delete");
    dialog = await deleteDialog(el);
    closed = dialogClosed(dialog.shadowRoot!.querySelector("wt-modal")!);
    await userEvent.click(confirmDelete(dialog));
    await closed;
    await settle(el);
    const add = el.shadowRoot!.querySelector("[data-test=new-theme]")!;
    expect(dialog.opener).toBe(add);
    await expect.poll(focused, { message: where() }).toBe(add.shadowRoot!.querySelector("button"));
  });
});
