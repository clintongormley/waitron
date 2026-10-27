import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import {
  chooseOption,
  mediaTestReference,
  useMediaPresentations,
} from "@waitron/ui/src/test-helpers.js";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  dialogClosed,
  mountWidget,
  openDisclosure,
  openFoldsAround,
} from "../widgets/test-helpers.js";
import type { ImageUpload } from "../widgets/image-upload.js";
import "./look-card.js";

class LookLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  list!: ThemeList;
  override render() {
    return html`<dashboard-look-card
        .api=${this.api}
        .list=${this.list}
        .canEdit=${true}
      ></dashboard-look-card>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("look-card-leave-test-app", LookLeaveApp);
type Card = HTMLElementTagNameMap["dashboard-look-card"];

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
const derived = deriveTheme(LUCIA);
const lucia: ThemeView = {
  id: "t-lucia",
  name: "Bar Lucía",
  updatedAt: "2026-10-21T10:00:00.000Z",
  choices: LUCIA,
  light: derived.light,
  dark: derived.dark,
  warnings: derived.warnings,
};

// Folds open at once rather than over their animation; a case about motion turns it back on first.
beforeEach(async () => {
  setLocale("en-GB");
  await commands.emulateReducedMotion("reduce");
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await commands.emulateReducedMotion(null);
});

async function mount(view: ThemeView = lucia) {
  const saveTheme = vi.fn(async (id: string, choices: ThemeChoices) => ({
    ...view,
    id,
    choices,
  }));
  const createTheme = vi.fn(async ({ name, theme }: { name: string; theme: ThemeChoices }) => ({
    ...lucia,
    id: "t-new",
    name,
    choices: theme,
  }));
  const getVenueTheme = vi.fn(async () => ({ hash: "h2", css: "", logo: null }));
  const api = { saveTheme, createTheme, getVenueTheme } as unknown as DashboardApi;
  const { el: app } = await mountWidget<LookLeaveApp>("look-card-leave-test-app", {
    api,
    list: { themes: [view], inUse: view.id },
  });
  const card = app.shadowRoot!.querySelector("dashboard-look-card")!;
  await card.updateComplete;
  await userEvent.click(q(card, "[data-test=edit]")!);
  await card.updateComplete;
  return { app, card, saveTheme, createTheme };
}
const q = (card: Card, selector: string) => card.shadowRoot!.querySelector<HTMLElement>(selector);
const corners = (card: Card) =>
  q(card, "wt-segmented-control[name=corners]") as HTMLElementTagNameMap["wt-segmented-control"];
const save = (card: Card) => q(card, "[data-test=save]") as HTMLElementTagNameMap["wt-button"];
const editing = (card: Card) => q(card, "section.settings-card")!.hasAttribute("data-editing");
async function square(card: Card) {
  const choice = [...corners(card).shadowRoot!.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === t("appearance.corners.square"),
  )!;
  await userEvent.click(choice);
  await card.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: LookLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: LookLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}

it("Keep on leaving with a changed draft keeps it", async () => {
  const { app, card } = await mount();
  await square(card);
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(corners(card).value).toBe("square");
  expect(unload()).toBe(true);
});

it("Discard on leaving restores the saved rows without a write", async () => {
  const { app, card, saveTheme } = await mount();
  await square(card);
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await expect.poll(() => editing(card)).toBe(false);
  expect(q(card, "[data-test=saved-corners]")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "Round",
  );
  expect(saveTheme).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});

it("a reverted draft leaves without asking", async () => {
  const { app, card } = await mount();
  await userEvent.click(q(card, 'button.swatch[data-color="#b12525"]')!);
  await card.updateComplete;
  expect(unload()).toBe(true);
  const code = q(card, "wt-input[name=brandColor]")!.shadowRoot!.querySelector("input")!;
  await page.elementLocator(code).fill("#1e5b3a");
  await card.updateComplete;
  expect(save(card).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("Cancel asks with a changed draft: Keep stays, Discard returns to the saved rows", async () => {
  const { app, card, saveTheme } = await mount();
  await square(card);
  q(card, "[data-test=cancel]")!.click();
  await choose(app, "keep");
  expect(editing(card)).toBe(true);
  expect(corners(card).value).toBe("square");
  q(card, "[data-test=cancel]")!.click();
  await choose(app, "discard");
  await expect.poll(() => editing(card)).toBe(false);
  expect(saveTheme).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});

it("after a successful save, leaving asks nothing", async () => {
  const { app, card, saveTheme } = await mount();
  await square(card);
  await userEvent.click(save(card));
  await expect.poll(() => editing(card)).toBe(false);
  expect(saveTheme).toHaveBeenCalledTimes(1);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("an edit made before the card is taken out still counts once it is put back", async () => {
  const { app, card } = await mount();
  await square(card);
  card.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(card);
  await card.updateComplete;
  await expect.poll(() => corners(card)?.value).toBe("square");
  expect(save(card).disabled).toBe(false);
  expect(unload()).toBe(true);
});

const nameDialog = (card: Card) =>
  q(card, "dashboard-theme-name-dialog")!.shadowRoot!.querySelector<
    HTMLElementTagNameMap["wt-dialog"]
  >("wt-dialog[data-test=name-dialog]")!;
async function openSaveAsNew(card: Card) {
  await userEvent.click(q(card, "[data-test=save-as-new]")!);
  const dialog = nameDialog(card);
  await expect.poll(() => dialog.open).toBe(true);
  return dialog;
}

it("Back in Save as new theme's name dialog returns to the editor, which still asks", async () => {
  const { app, card, createTheme } = await mount();
  await square(card);
  const dialog = await openSaveAsNew(card);
  const closed = dialogClosed(dialog);
  dialog.querySelector<HTMLElement>("wt-button[data-test=name-back]")!.click();
  await closed;
  await card.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(editing(card)).toBe(true);
  expect(corners(card).value).toBe("square");
  expect(createTheme).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(corners(card).value).toBe("square");
});

it("after a successful Save as new theme, leaving asks nothing", async () => {
  const { app, card, createTheme, saveTheme } = await mount();
  await square(card);
  const dialog = await openSaveAsNew(card);
  dialog.querySelector<HTMLElement>("wt-button[data-test=name-save]")!.click();
  await expect.poll(() => editing(card)).toBe(false);
  expect(createTheme).toHaveBeenCalledTimes(1);
  expect(saveTheme).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

type Advanced = HTMLElementTagNameMap["dashboard-theme-advanced"];
const advanced = (card: Card) => q(card, "dashboard-theme-advanced") as Advanced;
const inAdvanced = (card: Card, selector: string) =>
  advanced(card).shadowRoot!.querySelector<HTMLElement>(selector);
const disclosure = (card: Card) =>
  inAdvanced(card, "[data-test=advanced]") as HTMLElementTagNameMap["wt-disclosure"];
async function settle(card: Card) {
  await card.updateComplete;
  await advanced(card).updateComplete;
}
async function openAdvanced(card: Card) {
  await openDisclosure(disclosure(card));
}
async function typeHand(card: Card, mode: string, key: string, value: string) {
  const field = inAdvanced(card, `wt-input[name="handSet.${mode}.${key}"]`)!;
  const inner = field.shadowRoot!.querySelector("input")!;
  await openFoldsAround(inner);
  await page.elementLocator(inner).fill(value);
  await settle(card);
}
async function pressInAdvanced(card: Card, name: string) {
  await openFoldsAround(inAdvanced(card, `[data-test=${name}]`)!);
  await userEvent.click(inAdvanced(card, `[data-test=${name}]`)!);
  await settle(card);
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const CREAM = theme("t-cream", "Cream", {
  ...LUCIA,
  handSet: { light: { bg: "#f8f1e1" }, dark: {} },
});
function theme(id: string, name: string, choices: ThemeChoices): ThemeView {
  const worked = deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: worked.light,
    dark: worked.dark,
    warnings: worked.warnings,
  };
}

describe("leaving with Advanced", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a value set by its picker asks, and Discard returns to the saved rows without a write", async () => {
    const { app, card, saveTheme } = await mount();
    await openAdvanced(card);
    const picker = inAdvanced(
      card,
      'input[type=color][name="handSetPicker.light.bg"]',
    ) as HTMLInputElement;
    picker.value = "#f8f1e1";
    picker.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrame();
    await settle(card);
    expect(advanced(card).draft.choices.handSet.light).toEqual({ bg: "#f8f1e1" });
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "discard");
    expect(await request).toBe("proceeded");
    await expect.poll(() => editing(card)).toBe(false);
    expect(q(card, "[data-test=saved-hand]")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
      t("appearance.none"),
    );
    expect(saveTheme).not.toHaveBeenCalled();
    expect(unload()).toBe(false);
  });

  it("a half-typed code alone asks", async () => {
    const { app, card } = await mount();
    await typeHand(card, "light", "bg", "#12");
    expect(advanced(card).draft.choices.handSet).toEqual({ light: {}, dark: {} });
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "keep");
    expect(await request).toBe("kept");
    expect(editing(card)).toBe(true);
  });

  it("the stored colour typed again in capitals asks nothing", async () => {
    const { app, card } = await mount(CREAM);
    await typeHand(card, "light", "bg", "#F8F1E1");
    expect(save(card).disabled).toBe(true);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });

  it("Use worked-out colour back to the opened draft leaves without asking", async () => {
    const { app, card } = await mount();
    await typeHand(card, "light", "bg", "#f8f1e1");
    expect(unload()).toBe(true);
    await pressInAdvanced(card, "hand-worked-out-light-bg");
    expect(save(card).disabled).toBe(true);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });

  it("Reset all over a stored colour set by hand asks", async () => {
    const { app, card, saveTheme } = await mount(CREAM);
    await openAdvanced(card);
    await pressInAdvanced(card, "reset-all");
    expect(advanced(card).draft.choices.handSet).toEqual({ light: {}, dark: {} });
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "keep");
    expect(await request).toBe("kept");
    expect(advanced(card).draft.choices.handSet).toEqual({ light: {}, dark: {} });
    expect(saveTheme).not.toHaveBeenCalled();
  });

  it("Cancel just after a pick still waiting for its frame asks, and Keep keeps the pick", async () => {
    const { app, card } = await mount();
    await openAdvanced(card);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const picker = inAdvanced(
      card,
      'input[type=color][name="handSetPicker.light.bg"]',
    ) as HTMLInputElement;
    picker.value = "#f8f1e1";
    picker.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await userEvent.click(q(card, "[data-test=cancel]")!);
    await card.updateComplete;
    for (const frame of frames.splice(0)) frame(performance.now());
    vi.restoreAllMocks();
    await choose(app, "keep");
    expect(editing(card)).toBe(true);
    expect(advanced(card).draft.choices.handSet.light).toEqual({ bg: "#f8f1e1" });
  });

  it("Pick a different colour for dark screens alone asks nothing", async () => {
    const { app, card } = await mount();
    await userEvent.click(q(card, "[data-test=pick-dark]")!);
    await settle(card);
    expect(disclosure(card).open).toBe(true);
    expect(save(card).disabled).toBe(true);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });
});

describe("the logo in an unsaved draft", () => {
  useMediaPresentations();
  const L = mediaTestReference("lucia.png");
  const field = (card: Card) =>
    q(card, "dashboard-theme-logo-field") as HTMLElementTagNameMap["dashboard-theme-logo-field"];
  async function pickMain(card: Card, image: string | null) {
    const upload = field(card).shadowRoot!.querySelector<ImageUpload>(
      'dashboard-image-upload[name="logo.light"]',
    )!;
    upload.dispatchEvent(
      new CustomEvent("image-changed", { detail: { image }, bubbles: true, composed: true }),
    );
    await card.updateComplete;
  }

  it("a picked logo asks before leaving, and Discard drops it", async () => {
    const { app, card, saveTheme } = await mount();
    await pickMain(card, L);
    expect(field(card).logo).toEqual({ light: L });
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "discard");
    expect(await request).toBe("proceeded");
    await expect.poll(() => editing(card)).toBe(false);
    await userEvent.click(q(card, "[data-test=edit]")!);
    await card.updateComplete;
    expect(field(card).logo).toBeNull();
    expect(saveTheme).not.toHaveBeenCalled();
    expect(unload()).toBe(false);
  });

  it("putting the opened logo back counts as unchanged", async () => {
    const { app, card } = await mount({ ...lucia, choices: { ...LUCIA, logo: { light: L } } });
    expect(field(card).logo).toEqual({ light: L });
    await pickMain(card, null);
    expect(save(card).disabled).toBe(false);
    expect(unload()).toBe(true);
    await pickMain(card, L);
    expect(save(card).disabled).toBe(true);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });
});

describe("the text size in an unsaved draft", () => {
  const slider = (card: Card) =>
    q(card, "wt-slider[name=textScale]") as HTMLElementTagNameMap["wt-slider"];
  async function slide(card: Card, value: number) {
    const input = slider(card).shadowRoot!.querySelector("input")!;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await card.updateComplete;
  }

  it("a moved text size asks before leaving, and Discard drops it", async () => {
    const { app, card, saveTheme } = await mount();
    await slide(card, 125);
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "discard");
    expect(await request).toBe("proceeded");
    await expect.poll(() => editing(card)).toBe(false);
    await userEvent.click(q(card, "[data-test=edit]")!);
    await card.updateComplete;
    expect(slider(card).value).toBe(100);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(unload()).toBe(false);
  });

  it("moving it back to the opened size asks nothing, and Save is quiet again", async () => {
    const { app, card } = await mount({ ...lucia, choices: { ...LUCIA, textScale: 110 } });
    expect(slider(card).value).toBe(110);
    await slide(card, 125);
    expect(save(card).disabled).toBe(false);
    expect(save(card).variant).toBe("primary");
    expect(unload()).toBe(true);
    await slide(card, 110);
    expect(save(card).disabled).toBe(true);
    expect(save(card).variant).toBe("secondary");
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });
});

describe("text set by hand in an unsaved draft", () => {
  const textRows = (card: Card) =>
    inAdvanced(card, "dashboard-theme-text") as HTMLElementTagNameMap["dashboard-theme-text"];
  async function chooseBold(card: Card, value: string) {
    const bold = textRows(card).shadowRoot!.querySelector('wt-combobox[name="text.weight.bold"]')!;
    await openFoldsAround(bold);
    await chooseOption(bold, value);
    await settle(card);
    await textRows(card).updateComplete;
  }

  it("a text change asks on leaving; Use worked-out asks nothing", async () => {
    const { app, card } = await mount();
    await chooseBold(card, "800");
    expect(unload()).toBe(true);
    await chooseBold(card, "600");
    // 600 is Waitron's own Bold, but picked it is set by hand.
    expect(unload()).toBe(true);
    expect(save(card).disabled).toBe(false);
    const workedOut = textRows(card).shadowRoot!.querySelector<HTMLElement>(
      '[data-test="text-worked-out-weight.bold"]',
    )!;
    await openFoldsAround(workedOut);
    await userEvent.click(workedOut);
    await settle(card);
    expect(unload()).toBe(false);
    expect(save(card).disabled).toBe(true);
    expect(await leave(app)).toBe("proceeded");
  });

  it("after saving a text change, leaving asks nothing", async () => {
    const { app, card, saveTheme } = await mount();
    await chooseBold(card, "800");
    await userEvent.click(save(card));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme.mock.calls[0]![1].text).toEqual({ weight: { bold: 800 } });
    await expect.poll(() => editing(card)).toBe(false);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });
});
