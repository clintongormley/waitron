import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { THEME_COLOURS, type ThemeChoices, type ThemeColour } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { es } from "../i18n/strings.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { openDraft, setHand, typeHandCode, type LookDraft } from "./look-draft.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { advancedSummary, themeColourName } from "./theme-words.js";
import type { HandAction, ThemeAdvanced } from "./theme-advanced.js";
import "./theme-advanced.js";

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
};
const CREAM = setHand(openDraft(LUCIA), "light", "bg", "#f8f1e1");

beforeEach(() => setLocale("en-GB"));

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(draft: LookDraft, extra: Partial<ThemeAdvanced> = {}) {
  const { el } = await mountWidget<ThemeAdvanced>("dashboard-theme-advanced", {
    draft,
    derived: deriveTheme(draft.choices),
    ...extra,
  });
  return el;
}

const q = <T extends Element = HTMLElement>(el: ThemeAdvanced, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector)!;
const disclosure = (el: ThemeAdvanced) =>
  q<HTMLElementTagNameMap["wt-disclosure"]>(el, "[data-test=advanced]");
const codeField = (el: ThemeAdvanced, mode: string, key: string) =>
  q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="handSet.${mode}.${key}"]`);
const picker = (el: ThemeAdvanced, mode: string, key: string) =>
  q<HTMLInputElement>(el, `input[type=color][name="handSetPicker.${mode}.${key}"]`);
const status = (el: ThemeAdvanced, mode: string, key: string) =>
  q(el, `[data-test=hand-status-${mode}-${key}]`).textContent!.trim();
const workedOut = (el: ThemeAdvanced, mode: string, key: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test=hand-worked-out-${mode}-${key}]`,
  );

async function open(el: ThemeAdvanced): Promise<void> {
  const d = disclosure(el);
  await userEvent.click(d.shadowRoot!.querySelector("button.header")!);
  await d.updateComplete;
  await el.updateComplete;
}

function actions(el: ThemeAdvanced): HandAction[] {
  const seen: HandAction[] = [];
  el.addEventListener("hand-change", (event) =>
    seen.push((event as CustomEvent<HandAction>).detail),
  );
  return seen;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

describe("closed", () => {
  it("is closed when mounted, headed Advanced, with the hand-set colours as its closed line", async () => {
    const el = await mount(CREAM);
    const d = disclosure(el);
    expect(d.open).toBe(false);
    expect(d.heading).toBe(t("appearance.advanced"));
    expect(d.summary).toBe(advancedSummary(CREAM.choices, deriveTheme(CREAM.choices).warnings));
    expect(d.summary).toBe("1 set by hand: Page (light)");
    expect(d.contains(q(el, "[data-test=hand-row-bg]"))).toBe(true);
  });
});

describe("opened", () => {
  it("draws the intro, the column heads and 22 rows of two values each", async () => {
    const el = await mount(CREAM);
    await open(el);
    expect(q(el, "[data-test=advanced-intro]").textContent!.trim()).toBe(
      t("appearance.advanced_intro"),
    );
    const head = q(el, ".head");
    expect(head.getAttribute("aria-hidden")).toBe("true");
    expect([...head.children].map((c) => c.textContent!.trim())).toEqual([
      "Colour",
      "Light screens",
      "Dark screens",
    ]);
    const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test^=hand-row-]")];
    expect(rows.map((row) => row.dataset.test)).toEqual(
      THEME_COLOURS.map((key) => `hand-row-${key}`),
    );
    expect(rows.map((row) => row.querySelector(".name")!.textContent!.trim())).toEqual(
      THEME_COLOURS.map(themeColourName),
    );
    expect(el.shadowRoot!.querySelectorAll("wt-input[name^='handSet.']")).toHaveLength(44);
    expect(
      el.shadowRoot!.querySelectorAll("input[type=color][name^='handSetPicker.']"),
    ).toHaveLength(44);
    for (const key of THEME_COLOURS)
      for (const mode of ["light", "dark"]) {
        expect(codeField(el, mode, key)).not.toBeNull();
        expect(picker(el, mode, key)).not.toBeNull();
      }
  });

  it("says how each value is set, bold when set by hand", async () => {
    const el = await mount(CREAM);
    await open(el);
    const bold = getComputedStyle(el).getPropertyValue("--wt-font-weight-bold").trim();
    const inner = (mode: string, key: string) =>
      codeField(el, mode, key).shadowRoot!.querySelector("input")!;
    expect(getComputedStyle(inner("light", "bg")).fontWeight).toBe(bold);
    expect(getComputedStyle(inner("dark", "bg")).fontWeight).not.toBe(bold);
    expect(status(el, "light", "bg")).toBe("Set by hand");
    expect(workedOut(el, "light", "bg")!.textContent!.trim()).toBe("Use worked-out colour");
    expect(codeField(el, "dark", "bg").value).toBe("#0b110d");
    expect(status(el, "dark", "bg")).toBe("Worked out");
    expect(workedOut(el, "dark", "bg")).toBeNull();
    expect(status(el, "light", "primary")).toBe("Brand colour");
    expect(status(el, "dark", "primary")).toBe("Fixed");

    const own = setHand(CREAM, "dark", "primary", "#5fa77a");
    el.draft = own;
    el.derived = deriveTheme(own.choices);
    await el.updateComplete;
    expect(status(el, "dark", "primary")).toBe("Set by hand");
  });

  it("shows typed text over the colour, and the picker the colour set by hand or worked out", async () => {
    const typed = typeHandCode(CREAM, "light", "text", "#12");
    const el = await mount(typed);
    await open(el);
    const derived = deriveTheme(typed.choices);
    expect(codeField(el, "light", "text").value).toBe("#12");
    expect(picker(el, "light", "text").value).toBe(derived.light["--wt-color-text"]);
    expect(status(el, "light", "text")).toBe("Set by hand");
    expect(codeField(el, "light", "bg").value).toBe("#f8f1e1");
    expect(picker(el, "light", "bg").value).toBe("#f8f1e1");
    expect(picker(el, "dark", "bg").value).toBe(derived.dark["--wt-color-bg"]);
  });
});

describe("events", () => {
  it("a pick, a typed code, a worked-out colour and a reset each send one hand-change", async () => {
    const el = await mount(CREAM);
    await open(el);
    const seen = actions(el);
    const input = picker(el, "dark", "surface");
    input.value = "#223344";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrame();
    expect(seen).toEqual([{ kind: "pick", mode: "dark", key: "surface", colour: "#223344" }]);

    const inner = codeField(el, "light", "text").shadowRoot!.querySelector("input")!;
    await page.elementLocator(inner).fill("#abc");
    expect(seen.at(-1)).toEqual({ kind: "type", mode: "light", key: "text", text: "#abc" });

    const link = workedOut(el, "light", "bg")!;
    expect(link.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(
      "Use worked-out colour: Page, light screens",
    );
    await userEvent.click(link);
    expect(seen.at(-1)).toEqual({ kind: "worked-out", mode: "light", key: "bg" });

    const reset = q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=reset-all]");
    expect(reset.variant).toBe("secondary");
    expect(reset.textContent!.trim()).toBe("Reset all to worked-out");
    expect(reset.disabled).toBe(false);
    await userEvent.click(reset);
    expect(seen.at(-1)).toEqual({ kind: "reset-all" });
    expect(seen).toHaveLength(4);
  });

  it("names a row's button by its value in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(CREAM);
    await open(el);
    const value = fill("appearance.hand_value", {
      name: es["appearance.colour.bg"],
      screens: es["appearance.saved_fix_light"],
    });
    const label = fill("appearance.hand_action", {
      action: es["appearance.use_worked_out"],
      value,
    });
    expect(label).toBe("Usar el color calculado: Página, pantallas claras");
    expect(
      workedOut(el, "light", "bg")!.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
    ).toBe(label);
    expect(picker(el, "light", "bg").getAttribute("aria-label")).toBe(value);
  });

  it("Reset all waits while nothing is set by hand", async () => {
    const el = await mount(openDraft(LUCIA));
    await open(el);
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=reset-all]").disabled).toBe(true);
  });

  it("busy disables every control", async () => {
    const el = await mount(CREAM, { busy: true });
    await open(el);
    const controls = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>("input[type=color]"),
      ...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input"),
      ...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-button"]>("wt-button"),
    ];
    expect(controls.length).toBe(44 + 44 + 2);
    expect(controls.every((control) => control.disabled)).toBe(true);
  });
});

describe("errors and focus", () => {
  it("an error under a value opens the section", async () => {
    const el = await mount(CREAM);
    expect(disclosure(el).open).toBe(false);
    el.errors = { "handSet.light.bg": "x" };
    await el.updateComplete;
    await disclosure(el).updateComplete;
    expect(codeField(el, "light", "bg").error).toBe("x");
    expect(disclosure(el).hasAttribute("has-error")).toBe(true);
    expect(disclosure(el).open).toBe(true);
  });

  it("a warning leaves it closed", async () => {
    const sage = setHand(CREAM, "light", "text-muted", "#8fa898");
    const el = await mount(sage);
    expect(el.derived.warnings.length).toBeGreaterThan(0);
    expect(disclosure(el).hasAttribute("has-error")).toBe(false);
    expect(disclosure(el).open).toBe(false);
  });

  it("reveal opens the section and focuses that value's code field", async () => {
    const el = await mount(CREAM);
    await el.reveal("dark", "primary");
    expect(disclosure(el).open).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(codeField(el, "dark", "primary"));
  });
});

describe("layout", () => {
  const box = (el: Element) => el.getBoundingClientRect();
  const modeLabels = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".mode-label")];

  async function rowAt(width: number, key: ThemeColour) {
    await page.viewport(width, 900);
    const el = await mount(CREAM);
    await open(el);
    const row = q(el, `[data-test=hand-row-${key}]`);
    const [light, dark] = [...row.querySelectorAll<HTMLElement>(".value")];
    return { row, name: row.querySelector<HTMLElement>(".name")!, light: light!, dark: dark! };
  }

  const restore = { width: innerWidth, height: innerHeight };
  afterEach(async () => {
    await page.viewport(restore.width, restore.height);
  });

  it("stacks name, Light and Dark at phone width", async () => {
    const { row, name, light, dark } = await rowAt(390, "bg");
    expect(Math.abs(box(light).left - box(name).left)).toBeLessThanOrEqual(1);
    expect(box(dark).top).toBeGreaterThanOrEqual(box(light).bottom);
    expect(modeLabels(row).map((label) => label.textContent!.trim())).toEqual([
      t("theme.light"),
      t("theme.dark"),
    ]);
    for (const label of modeLabels(row)) expect(box(label).height).toBeGreaterThan(0);
  });

  it("sets Light and Dark side by side when wide", async () => {
    const { row, light, dark } = await rowAt(1280, "bg");
    expect(Math.abs(box(light).top - box(dark).top)).toBeLessThanOrEqual(2);
    for (const label of modeLabels(row)) expect(getComputedStyle(label).display).toBe("none");
  });
});
