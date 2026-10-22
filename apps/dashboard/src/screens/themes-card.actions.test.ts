import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtDialog, WtInput, WtRowActions, WtSwitch } from "@waitron/ui";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  dialogClosed,
  dialogMessageOf,
  mountWidget,
} from "../widgets/test-helpers.js";
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
  handSet: { light: {}, dark: {} },
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
  const api = { createTheme, renameTheme, getVenueTheme } as unknown as DashboardApi;
  return { api, createTheme, renameTheme, getVenueTheme };
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

  it("Edit and New theme ask the page to open the editor", async () => {
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

  it("Rename changes only the name", async () => {
    const { el, changes, renameTheme, getVenueTheme } = await mount(four);
    await choose(el, "t-xmas", "rename");
    const dialog = await nameDialog(el);
    expect(toggle(dialog)).toBeNull();
    expect(input(dialog).value).toBe("Christmas");
    await type(el, dialog, "Navidad");
    const closed = dialogClosed(dialog);
    await userEvent.click(save(dialog));
    await closed;
    expect(renameTheme).toHaveBeenCalledTimes(1);
    expect(renameTheme).toHaveBeenCalledWith("t-xmas", "Navidad");
    expect(changes).toEqual([{ kind: "renamed", theme: { ...xmas, name: "Navidad" } }]);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("a rename of a theme deleted elsewhere says so", async () => {
    const { el, changes, renameTheme } = await mount(four);
    renameTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await choose(el, "t-xmas", "rename");
    const dialog = await nameDialog(el);
    await type(el, dialog, "Navidad");
    await userEvent.click(save(dialog));
    await settle(el);
    expect(dialog.open).toBe(true);
    expect(await dialogMessageOf(dialog)).toBe(codeMessage("theme.not_found"));
    expect(codeMessage("theme.not_found")).toBe("This theme no longer exists.");
    expect(save(dialog).disabled).toBe(false);
    expect(changes).toEqual([]);
  });
});
