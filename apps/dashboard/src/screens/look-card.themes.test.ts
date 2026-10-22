import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtButton, WtDialog, WtInput, WtSwitch } from "@waitron/ui";
import { createLeaveCoordinator, type LeaveDecision } from "@waitron/ui-core/unsaved-changes";
import { WAITRON_CHOICES, normaliseChoices, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import type { ThemesChanged } from "./themes-card.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const q = (el: Card, selector: string) => el.shadowRoot!.querySelector(selector);

function theme(id: string, name: string, choices: ThemeChoices | null): ThemeView {
  const derived = choices === null ? null : deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived?.light ?? null,
    dark: derived?.dark ?? null,
    warnings: derived?.warnings ?? [],
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
const waitronInUse: ThemeList = { themes: [lucia, xmas], inUse: null };
const luciaInUse: ThemeList = { themes: [lucia, xmas], inUse: "t-lucia" };

function stubApi() {
  const createTheme = vi.fn<DashboardApi["createTheme"]>(async ({ name, theme: choices }) =>
    theme("t-new", name, choices),
  );
  const saveTheme = vi.fn<DashboardApi["saveTheme"]>(async (id, choices) =>
    theme(id, id === "t-xmas" ? "Christmas" : "Bar Lucía", choices),
  );
  const getVenueTheme = vi.fn(async () => ({ hash: "h2", css: "", logo: null }));
  const api = { createTheme, saveTheme, getVenueTheme } as unknown as DashboardApi;
  return { api, createTheme, saveTheme, getVenueTheme };
}

async function mount(list: ThemeList, canEdit = true) {
  const stub = stubApi();
  const { el } = await mountWidget<Card>("dashboard-look-card", { api: stub.api, list, canEdit });
  const changes: ThemesChanged[] = [];
  const editing: unknown[] = [];
  el.addEventListener("themes-changed", (event) =>
    changes.push((event as CustomEvent<ThemesChanged>).detail),
  );
  el.addEventListener("look-editing", (event) => editing.push((event as CustomEvent).detail));
  return { el, changes, editing, ...stub };
}

const button = (el: Card, name: string) => q(el, `[data-test=${name}]`) as WtButton;
const heading = (el: Card) => text(q(el, "section.settings-card header > h2"));
const line = (el: Card) => text(q(el, "[data-test=editing-line]"));
const isEditing = (el: Card) => q(el, "section.settings-card")!.hasAttribute("data-editing");
const codeField = (el: Card) => q(el, "wt-input[name=brandColor]") as WtInput;

async function settle(el: Card): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function pickSwatch(el: Card, colour: string): Promise<void> {
  await userEvent.click(q(el, `button.swatch[data-color="${colour}"]`)!);
  await el.updateComplete;
}

async function openWaitronEditor(el: Card): Promise<void> {
  await userEvent.click(button(el, "edit"));
  await el.updateComplete;
}

const nameHost = (el: Card) =>
  q(el, "dashboard-theme-name-dialog") as HTMLElementTagNameMap["dashboard-theme-name-dialog"];
const nameDialogOf = (el: Card) =>
  nameHost(el).shadowRoot!.querySelector<WtDialog>("wt-dialog[data-test=name-dialog]")!;

async function nameDialog(el: Card): Promise<WtDialog> {
  await nameHost(el).updateComplete;
  const dialog = nameDialogOf(el);
  await expect.poll(() => dialog.open).toBe(true);
  return dialog;
}

const nameInput = (dialog: WtDialog) => dialog.querySelector<WtInput>("wt-input[name=name]")!;
const toggle = (dialog: WtDialog) => dialog.querySelector<WtSwitch>("wt-switch[name=inUse]")!;
const nameSave = (dialog: WtDialog) =>
  dialog.querySelector<WtButton>("wt-button[data-test=name-save]")!;
const nameBack = (dialog: WtDialog) =>
  dialog.querySelector<WtButton>("wt-button[data-test=name-back]")!;
const nameWarnings = (dialog: WtDialog) =>
  [...dialog.querySelectorAll("[data-test=name-warnings] li")].map((li) => text(li));

async function typeName(el: Card, dialog: WtDialog, value: string): Promise<void> {
  nameInput(dialog).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}

type HardToRead = HTMLElementTagNameMap["dashboard-hard-to-read-dialog"];
const hardToRead = (el: Card) => q(el, "dashboard-hard-to-read-dialog") as HardToRead;
const hardDialog = (el: Card) => hardToRead(el).shadowRoot!.querySelector("wt-dialog")!;
const hardButton = (el: Card, name: string) =>
  hardToRead(el).shadowRoot!.querySelector<WtButton>(`[data-test=${name}]`)!;

async function typeInCode(el: Card, value: string): Promise<void> {
  const inner = codeField(el).shadowRoot!.querySelector("input")!;
  await page.elementLocator(inner).fill(value);
  await el.updateComplete;
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("the editor's three ways in", () => {
  it("Edit while Waitron's theme is in use opens on Waitron's choices", async () => {
    setLocale("en-GB");
    const { el, editing } = await mount(waitronInUse);
    expect(button(el, "edit")).not.toBeNull();
    await openWaitronEditor(el);
    expect(isEditing(el)).toBe(true);
    expect(heading(el)).toBe("Look");
    expect(line(el)).toBe("Theme in use: Waitron. Saving changes every screen.");
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
    expect(button(el, "use-waitron").disabled).toBe(true);
    expect(editing).toEqual([{ id: null }]);
  });

  it("its Save asks for a name, switch on, and creates the theme in use", async () => {
    setLocale("en-GB");
    const { el, changes, createTheme, getVenueTheme, saveTheme } = await mount(waitronInUse);
    await openWaitronEditor(el);
    await pickSwatch(el, "#dd5f5f");
    expect(deriveTheme({ ...WAITRON_CHOICES, brandColor: "#dd5f5f" }).warnings).toEqual([]);
    await userEvent.click(button(el, "save"));
    const dialog = await nameDialog(el);
    expect(nameInput(dialog).value).toBe("");
    expect(toggle(dialog).checked).toBe(true);
    expect(nameSave(dialog).disabled).toBe(true);
    await typeName(el, dialog, "Bar Lucía");
    expect(nameSave(dialog).disabled).toBe(false);
    await userEvent.click(nameSave(dialog));
    await expect.poll(() => isEditing(el)).toBe(false);
    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(createTheme).toHaveBeenCalledWith({
      name: "Bar Lucía",
      theme: normaliseChoices({ ...WAITRON_CHOICES, brandColor: "#dd5f5f" }),
      inUse: true,
    });
    expect(saveTheme).not.toHaveBeenCalled();
    expect(changes).toEqual([
      { kind: "created", theme: await createTheme.mock.results[0]!.value, inUse: true },
    ]);
    await expect.poll(() => getVenueTheme.mock.calls.length).toBe(1);
  });

  it("Back in the name dialog keeps the draft", async () => {
    const { el, createTheme } = await mount(waitronInUse);
    await openWaitronEditor(el);
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    const dialog = await nameDialog(el);
    const closed = dialogClosed(dialog);
    await userEvent.click(nameBack(dialog));
    await closed;
    await el.updateComplete;
    expect(dialog.open).toBe(false);
    expect(isEditing(el)).toBe(true);
    expect(codeField(el).value).toBe("#dd5f5f");
    expect(button(el, "save").disabled).toBe(false);
    expect(createTheme).not.toHaveBeenCalled();
  });

  it("a draft with a warning asks Hard to read first, then the name", async () => {
    setLocale("en-GB");
    const { el, createTheme } = await mount(waitronInUse);
    await openWaitronEditor(el);
    await typeInCode(el, "#f2d300");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => hardDialog(el).open).toBe(true);
    expect(nameDialogOf(el).open).toBe(false);
    await userEvent.click(hardButton(el, "save-anyway"));
    let dialog = await nameDialog(el);
    expect(toggle(dialog).checked).toBe(true);
    expect(nameWarnings(dialog)).toEqual([
      "Brand colour: buttons are hard to see on light screens.",
    ]);
    await typeName(el, dialog, "Lemon");
    await userEvent.click(nameSave(dialog));
    await expect.poll(() => createTheme.mock.calls.length).toBe(1);
    expect(createTheme.mock.calls[0]![0].theme).toEqual({
      ...WAITRON_CHOICES,
      brandColor: "#f2d300",
      brandFix: {},
    });
    await expect.poll(() => isEditing(el)).toBe(false);

    await openWaitronEditor(el);
    await typeInCode(el, "#f2d300");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => hardDialog(el).open).toBe(true);
    await userEvent.click(hardButton(el, "fix-and-save"));
    dialog = await nameDialog(el);
    expect(toggle(dialog).checked).toBe(true);
    expect(nameWarnings(dialog)).toEqual([]);
    const closed = dialogClosed(dialog);
    await userEvent.click(nameBack(dialog));
    await closed;
    await el.updateComplete;
    expect(isEditing(el)).toBe(true);
    expect(q(el, "[data-test=brand-fixed-light]")).not.toBeNull();
    await userEvent.click(button(el, "save"));
    dialog = await nameDialog(el);
    await typeName(el, dialog, "Lemon fixed");
    await userEvent.click(nameSave(dialog));
    await expect.poll(() => createTheme.mock.calls.length).toBe(2);
    expect(createTheme.mock.calls[1]![0].theme).toEqual({
      ...WAITRON_CHOICES,
      brandColor: "#f2d300",
      brandFix: { light: true },
    });
  });

  it("New theme opens on Waitron's choices, not in use", async () => {
    setLocale("en-GB");
    const { el, changes, createTheme, getVenueTheme, editing } = await mount(luciaInUse);
    el.edit({ kind: "new" });
    await el.updateComplete;
    expect(isEditing(el)).toBe(true);
    expect(heading(el)).toBe("New theme");
    expect(line(el)).toBe(t("appearance.editing_not_in_use"));
    expect(codeField(el).value).toBe("");
    expect(button(el, "save").disabled).toBe(true);
    expect(editing).toEqual([{ id: null }]);
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    const dialog = await nameDialog(el);
    expect(toggle(dialog).checked).toBe(false);
    await typeName(el, dialog, "Holiday");
    await userEvent.click(nameSave(dialog));
    await expect.poll(() => isEditing(el)).toBe(false);
    expect(createTheme).toHaveBeenCalledWith({
      name: "Holiday",
      theme: normaliseChoices({ ...WAITRON_CHOICES, brandColor: "#dd5f5f" }),
      inUse: false,
    });
    expect(changes).toEqual([
      { kind: "created", theme: await createTheme.mock.results[0]!.value, inUse: false },
    ]);
    await settle(el);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("a row's Edit opens a theme not in use under its own heading", async () => {
    setLocale("en-GB");
    const { el, changes, saveTheme, createTheme, getVenueTheme } = await mount(luciaInUse);
    el.edit({ id: "t-xmas" });
    await el.updateComplete;
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(line(el)).toBe(t("appearance.editing_not_in_use"));
    expect(codeField(el).value).toBe("#7a1f2b");
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => isEditing(el)).toBe(false);
    expect(nameDialogOf(el).open).toBe(false);
    expect(createTheme).not.toHaveBeenCalled();
    expect(saveTheme).toHaveBeenCalledTimes(1);
    expect(saveTheme.mock.calls[0]![0]).toBe("t-xmas");
    expect(changes).toEqual([{ kind: "saved", theme: await saveTheme.mock.results[0]!.value }]);
    await settle(el);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("Cancel on a theme not in use sends nothing and leaves the page's look alone", async () => {
    const { el, changes, saveTheme, getVenueTheme } = await mount(luciaInUse);
    el.edit({ id: "t-xmas" });
    await el.updateComplete;
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(isEditing(el)).toBe(false);
    await settle(el);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(getVenueTheme).not.toHaveBeenCalled();
  });
});

describe("what the editor announces and when it closes", () => {
  it("the editor announces what it has open", async () => {
    const { el, editing } = await mount(luciaInUse);
    el.edit({ id: "t-xmas" });
    await el.updateComplete;
    expect(editing).toEqual([{ id: "t-xmas" }]);
    await userEvent.click(button(el, "cancel"));
    await expect.poll(() => isEditing(el)).toBe(false);
    expect(editing).toEqual([{ id: "t-xmas" }, { id: null }]);

    el.edit({ id: "t-xmas" });
    await el.updateComplete;
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => isEditing(el)).toBe(false);
    expect(editing).toEqual([{ id: "t-xmas" }, { id: null }, { id: "t-xmas" }, { id: null }]);

    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    el.canEdit = false;
    await el.updateComplete;
    expect(isEditing(el)).toBe(false);
    expect(editing.slice(4)).toEqual([{ id: "t-lucia" }, { id: null }]);

    el.canEdit = true;
    el.edit({ kind: "new" });
    await el.updateComplete;
    expect(editing.slice(6)).toEqual([{ id: null }]);
  });

  it("losing the right to edit closes the name dialog too", async () => {
    const { el, createTheme } = await mount(waitronInUse);
    await openWaitronEditor(el);
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    const dialog = await nameDialog(el);
    const closed = dialogClosed(dialog);
    el.canEdit = false;
    await el.updateComplete;
    await closed;
    await el.updateComplete;
    expect(dialog.open).toBe(false);
    expect(isEditing(el)).toBe(false);
    expect(createTheme).not.toHaveBeenCalled();
  });
});

const corners = (el: Card) =>
  q(el, "wt-segmented-control[name=corners]") as HTMLElementTagNameMap["wt-segmented-control"];

async function square(el: Card): Promise<void> {
  const choice = [...corners(el).shadowRoot!.querySelectorAll("button")].find(
    (b) => text(b) === t("appearance.corners.square"),
  )!;
  await userEvent.click(choice);
  await el.updateComplete;
}

/** An application around the card whose leave question answers what `answer` resolves to. */
function withLeaveQuestion(el: Card) {
  let answer: (decision: LeaveDecision) => void = () => {};
  const ask = vi.fn(
    () =>
      new Promise<LeaveDecision>((resolve) => {
        answer = resolve;
      }),
  );
  const coordinator = createLeaveCoordinator(ask, window);
  el.parentElement!.addEventListener("wt-leave-coordinator", (event) => {
    event.stopPropagation();
    (event as CustomEvent<{ accept(value: unknown): void }>).detail.accept(coordinator);
  });
  return { ask, answer: (decision: LeaveDecision) => answer(decision) };
}

describe("opening the editor from the Themes card", () => {
  it("Edit on another theme with a changed draft asks first", async () => {
    setLocale("en-GB");
    const { el, editing } = await mount(luciaInUse);
    const { ask, answer } = withLeaveQuestion(el);
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    await square(el);

    el.edit({ id: "t-xmas" });
    await expect.poll(() => ask.mock.calls.length).toBe(1);
    answer("keep");
    await settle(el);
    expect(heading(el)).toBe("Look");
    expect(line(el)).toBe("Theme in use: Bar Lucía. Saving changes every screen.");
    expect(corners(el).value).toBe("square");
    expect(editing).toEqual([{ id: "t-lucia" }]);

    el.edit({ id: "t-xmas" });
    await expect.poll(() => ask.mock.calls.length).toBe(2);
    answer("discard");
    await settle(el);
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(codeField(el).value).toBe("#7a1f2b");
    expect(corners(el).value).toBe(WAITRON_CHOICES.corners);
    expect(button(el, "save").disabled).toBe(true);
    expect(editing.at(-1)).toEqual({ id: "t-xmas" });
  });

  it("a Discard opens the theme as the latest read has it", async () => {
    const { el } = await mount(luciaInUse);
    const { ask, answer } = withLeaveQuestion(el);
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    await square(el);
    el.edit({ id: "t-xmas" });
    await expect.poll(() => ask.mock.calls.length).toBe(1);
    const saved = theme("t-xmas", "Christmas", {
      ...WAITRON_CHOICES,
      brandColor: "#225588",
      brandFix: { dark: true },
    });
    el.list = { ...luciaInUse, themes: [lucia, saved] };
    await el.updateComplete;
    answer("discard");
    await settle(el);
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(codeField(el).value).toBe("#225588");
    expect(button(el, "save").disabled).toBe(true);
  });

  it("a Discard after the theme is deleted elsewhere opens it as last read", async () => {
    const { el, saveTheme } = await mount(luciaInUse);
    const { ask, answer } = withLeaveQuestion(el);
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    await square(el);
    el.edit({ id: "t-xmas" });
    await expect.poll(() => ask.mock.calls.length).toBe(1);
    el.list = { ...luciaInUse, themes: [lucia] };
    await el.updateComplete;
    answer("discard");
    await settle(el);
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(line(el)).toBe(t("appearance.editing_not_in_use"));
    expect(codeField(el).value).toBe("#7a1f2b");
    await pickSwatch(el, "#dd5f5f");
    saveTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme.mock.calls[0]![0]).toBe("t-xmas");
    await settle(el);
    expect(isEditing(el)).toBe(true);
    expect(button(el, "save").disabled).toBe(false);
  });

  it("a Discard answered after the right to edit is lost opens nothing", async () => {
    const { el, editing } = await mount(luciaInUse);
    const { ask, answer } = withLeaveQuestion(el);
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    await square(el);
    el.edit({ id: "t-xmas" });
    await expect.poll(() => ask.mock.calls.length).toBe(1);
    el.canEdit = false;
    await el.updateComplete;
    answer("discard");
    await settle(el);
    expect(isEditing(el)).toBe(false);
    expect(editing).toEqual([{ id: "t-lucia" }, { id: null }]);
  });

  it("Edit on another theme with an unchanged draft opens it without asking", async () => {
    const { el } = await mount(luciaInUse);
    const { ask } = withLeaveQuestion(el);
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    el.edit({ kind: "new" });
    await settle(el);
    expect(heading(el)).toBe("New theme");
    expect(ask).not.toHaveBeenCalled();
  });

  it("Edit on the theme already open only scrolls", async () => {
    const { el, editing } = await mount(luciaInUse);
    const { ask } = withLeaveQuestion(el);
    const scroll = vi.spyOn(el, "scrollIntoView").mockImplementation(() => {});
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenLastCalledWith({ block: "start" });
    await square(el);

    el.edit({ id: "t-lucia" });
    await settle(el);
    expect(ask).not.toHaveBeenCalled();
    expect(corners(el).value).toBe("square");
    expect(button(el, "save").disabled).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith({ block: "start" });
    expect(editing).toEqual([{ id: "t-lucia" }]);
  });

  it("Edit is refused without the right to edit and while a save is sent", async () => {
    const { el, editing, saveTheme } = await mount(luciaInUse, false);
    el.edit({ id: "t-xmas" });
    el.edit({ kind: "new" });
    await settle(el);
    expect(isEditing(el)).toBe(false);
    expect(editing).toEqual([]);

    el.canEdit = true;
    await el.updateComplete;
    let finish: (view: ThemeView) => void = () => {};
    saveTheme.mockImplementationOnce(
      () =>
        new Promise<ThemeView>((resolve) => {
          finish = resolve;
        }),
    );
    el.edit({ id: "t-lucia" });
    await el.updateComplete;
    await square(el);
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    el.edit({ id: "t-xmas" });
    await settle(el);
    expect(heading(el)).toBe("Look");
    expect(editing).toEqual([{ id: "t-lucia" }]);
    finish(theme("t-lucia", "Bar Lucía", { ...LUCIA, corners: "square" }));
    await expect.poll(() => isEditing(el)).toBe(false);
  });

  it("Edit on a theme no longer in the list opens nothing", async () => {
    const { el, editing } = await mount(luciaInUse);
    el.edit({ id: "t-gone" });
    await settle(el);
    expect(isEditing(el)).toBe(false);
    expect(editing).toEqual([]);
  });

  it("a name stored after the card is taken out and put back announces nothing", async () => {
    const { el, changes, createTheme, getVenueTheme } = await mount(luciaInUse);
    let finish: (view: ThemeView) => void = () => {};
    createTheme.mockImplementationOnce(
      () =>
        new Promise<ThemeView>((resolve) => {
          finish = resolve;
        }),
    );
    el.edit({ kind: "new" });
    await el.updateComplete;
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    const dialog = await nameDialog(el);
    await typeName(el, dialog, "Holiday");
    await userEvent.click(nameSave(dialog));
    await expect.poll(() => createTheme.mock.calls.length).toBe(1);
    const parent = el.parentElement!;
    el.remove();
    parent.append(el);
    await el.updateComplete;
    finish(theme("t-new", "Holiday", { ...WAITRON_CHOICES, brandColor: "#dd5f5f" }));
    await settle(el);
    await settle(el);
    expect(changes).toEqual([]);
    expect(isEditing(el)).toBe(true);
    expect(codeField(el).value).toBe("#dd5f5f");
    expect(getVenueTheme).not.toHaveBeenCalled();
  });

  it("Waitron's theme open while another is switched into use is a new theme", async () => {
    setLocale("en-GB");
    const { el } = await mount(waitronInUse);
    await openWaitronEditor(el);
    el.list = { ...waitronInUse, inUse: "t-xmas" };
    await el.updateComplete;
    expect(heading(el)).toBe("New theme");
    expect(line(el)).toBe(t("appearance.editing_not_in_use"));
    await pickSwatch(el, "#dd5f5f");
    await userEvent.click(button(el, "save"));
    const dialog = await nameDialog(el);
    expect(toggle(dialog).checked).toBe(false);
  });
});
