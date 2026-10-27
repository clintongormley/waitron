import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  THEME_COLOURS,
  WAITRON_CHOICES,
  type ColourWarning,
  type ThemeChoices,
  type ThemeColour,
} from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { es } from "../i18n/strings.js";
import { fill, setLocale, t } from "../i18n/t.js";
import {
  openDraft,
  setHand,
  setTypeface,
  typeHandCode,
  typeTextSize,
  type LookDraft,
} from "./look-draft.js";
import {
  cleanupWidgets,
  computedColour,
  dotOf,
  mountWidget,
  openDisclosure,
  openFoldsAround,
} from "./test-helpers.js";
import { advancedSummary, handWarningLines, themeColourName } from "./theme-words.js";
import type { HandAction, ThemeAdvanced } from "./theme-advanced.js";
import "./theme-advanced.js";

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
  await openDisclosure(disclosure(el));
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
    el.errors = { "handSet.light.bg": "x" };
    await el.updateComplete;
    await codeField(el, "light", "bg").updateComplete;
    const message = codeField(el, "light", "bg").shadowRoot!.querySelector("[data-error]")!;
    expect(getComputedStyle(message).fontWeight).toBe(
      getComputedStyle(el).getPropertyValue("--wt-font-weight-normal").trim(),
    );
    expect(getComputedStyle(inner("light", "bg")).fontWeight).toBe(bold);
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
    await openFoldsAround(input);
    input.value = "#223344";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrame();
    expect(seen).toEqual([{ kind: "pick", mode: "dark", key: "surface", colour: "#223344" }]);

    const inner = codeField(el, "light", "text").shadowRoot!.querySelector("input")!;
    await openFoldsAround(inner);
    await page.elementLocator(inner).fill("#abc");
    expect(seen.at(-1)).toEqual({ kind: "type", mode: "light", key: "text", text: "#abc" });

    const link = workedOut(el, "light", "bg")!;
    expect(link.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(
      "Use worked-out colour: Page, light screens",
    );
    await openFoldsAround(link);
    await userEvent.click(link);
    expect(seen.at(-1)).toEqual({ kind: "worked-out", mode: "light", key: "bg" });

    const reset = q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=reset-all]");
    expect(reset.variant).toBe("secondary");
    expect(reset.textContent!.trim()).toBe("Reset all to worked-out");
    expect(reset.disabled).toBe(false);
    await openFoldsAround(reset);
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

  it("an error key with no message leaves it closed", async () => {
    const el = await mount(CREAM, { errors: { "handSet.light.bg": undefined } });
    await disclosure(el).updateComplete;
    expect(disclosure(el).hasAttribute("has-error")).toBe(false);
    expect(disclosure(el).open).toBe(false);
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
    let focused: Element | null = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    expect(focused).toBe(
      codeField(el, "dark", "primary").shadowRoot!.querySelector(
        "input[name='handSet.dark.primary']",
      ),
    );
  });
});

describe("layout", () => {
  const box = (el: Element) => el.getBoundingClientRect();
  const modeLabels = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".mode-label")];

  async function rowAt(width: number, key: ThemeColour, section?: number) {
    await page.viewport(width, 900);
    const el = await mount(CREAM);
    if (section !== undefined) el.style.width = `${section}px`;
    const row = q(el, `[data-test=hand-row-${key}]`);
    await openFoldsAround(row);
    await el.updateComplete;
    await nextFrame();
    const [light, dark] = [...row.querySelectorAll<HTMLElement>(".value")];
    return { el, row, name: row.querySelector<HTMLElement>(".name")!, light: light!, dark: dark! };
  }
  const centre = (rect: DOMRect) => (rect.top + rect.bottom) / 2;
  /** Where a button's words are drawn, not its padded box. */
  const wordsBox = (button: Element) => {
    const range = document.createRange();
    range.selectNodeContents(button);
    return range.getBoundingClientRect();
  };

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

  // On a 390 px phone the Look card leaves Advanced 260 px (measured on the dashboard page), where
  // a hand-set Light line has about 8 px to spare in macOS's fonts; the status check gets 20 px
  // more, for CI's wider ones.
  for (const [width, section] of [
    [1280, undefined],
    [390, 260],
  ] as const) {
    it(`draws each code field just wide enough for its code, its status beside it (${width} px)`, async () => {
      const { el } = await rowAt(width, "bg", section && section + 20);
      for (const mode of ["light", "dark"] as const) {
        const code = box(codeField(el, mode, "bg"));
        const inner = codeField(el, mode, "bg").shadowRoot!.querySelector("input")!;
        expect(code.width, mode).toBeLessThan(140);
        expect(inner.scrollWidth, mode).toBeLessThanOrEqual(inner.clientWidth);
        const said = box(q(el, `[data-test=hand-status-${mode}-bg]`));
        expect(said.left, mode).toBeGreaterThanOrEqual(code.right);
        expect(Math.abs(centre(said) - centre(code)), mode).toBeLessThanOrEqual(4);
      }
    });

    it(`puts Use worked-out colour under its value, flush with the value's start (${width} px)`, async () => {
      const { el, light } = await rowAt(width, "bg", section);
      const link = workedOut(el, "light", "bg")!;
      expect(box(link).top).toBeGreaterThanOrEqual(box(codeField(el, "light", "bg")).bottom);
      expect(Math.abs(wordsBox(link).left - box(light).left)).toBeLessThanOrEqual(1);
    });

    it(`draws a line under every row and puts Reset all at the right (${width} px)`, async () => {
      const { el } = await rowAt(width, "bg", section);
      for (const row of el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test^=hand-row-]")) {
        const style = getComputedStyle(row);
        expect(style.borderBottomStyle, row.dataset.test).toBe("solid");
        expect(parseFloat(style.borderBottomWidth), row.dataset.test).toBeGreaterThan(0);
      }
      await openFoldsAround(q(el, "[data-test=reset-all]"));
      const reset = box(q(el, "[data-test=reset-all]"));
      expect(Math.abs(reset.right - box(q(el, ".table")).right)).toBeLessThanOrEqual(1);
    });
  }

  it("names Light and Dark on the line of their value at phone width, under a bold name", async () => {
    const { el, row, name } = await rowAt(390, "bg", 260);
    expect(Number(getComputedStyle(name).fontWeight)).toBeGreaterThanOrEqual(600);
    const [lightLabel, darkLabel] = modeLabels(row);
    for (const [mode, label] of [
      ["light", lightLabel!],
      ["dark", darkLabel!],
    ] as const) {
      const chip = box(picker(el, mode, "bg"));
      expect(box(label).right, mode).toBeLessThanOrEqual(chip.left);
      expect(Math.abs(centre(box(label)) - centre(chip)), mode).toBeLessThanOrEqual(4);
    }
  });
});

const SAGE = setHand(CREAM, "light", "text-muted", "#8fa898");
const TWO_FIXES = setHand(
  setHand(openDraft(WAITRON_CHOICES), "light", "text", "#6a6a6a"),
  "light",
  "surface-sunken",
  "#bbbbbb",
);
const HOVER = setHand(openDraft(WAITRON_CHOICES), "light", "primary-hover", "#787878");
const DARK = setHand(
  setHand(openDraft(WAITRON_CHOICES), "dark", "bg", "#000000"),
  "dark",
  "text",
  "#222222",
);

const warningLine = (el: ThemeAdvanced, mode: string, key: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=hand-warning-${mode}-${key}]`);
const rowButton = (el: ThemeAdvanced, test: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`);
const innerLabel = (button: HTMLElementTagNameMap["wt-button"]) =>
  button.shadowRoot!.querySelector("button")!.getAttribute("aria-label");
const linesOf = (draft: LookDraft, field: string) =>
  handWarningLines(
    deriveTheme(draft.choices).warnings.find(
      (warning): warning is ColourWarning => warning.field === field,
    )!,
    draft.choices,
  );

describe("warnings under the rows", () => {
  it("warns under Secondary text with its fix, and under Page with the blocked sentence", async () => {
    const el = await mount(SAGE);
    await open(el);
    const line = warningLine(el, "light", "text-muted")!;
    const [sage] = linesOf(SAGE, "handSet.light.text-muted");
    expect(line.textContent!.trim()).toBe(sage);
    expect(q(el, "[data-test=hand-row-text-muted]").contains(line)).toBe(true);
    const icon = line.parentElement!.querySelector("wt-icon")!;
    expect(icon.getAttribute("name")).toBe("warning");
    const warningColour = computedColour(el.shadowRoot!, "var(--wt-color-warning)");
    expect(getComputedStyle(line).color).toBe(warningColour);
    expect(getComputedStyle(icon).color).toBe(warningColour);

    const fix = rowButton(el, "hand-fix-light-text-muted")!;
    expect(fix.textContent!.trim()).toBe("Use #526a5b");
    expect(fix.size).toBe("sm");
    expect(innerLabel(fix)).toBe("Use #526a5b: Secondary text, light screens");
    const seen = actions(el);
    await openFoldsAround(fix);
    await userEvent.click(fix);
    expect(seen).toEqual([{ kind: "fix", mode: "light", key: "text-muted", fix: "#526a5b" }]);

    const page = warningLine(el, "light", "bg")!;
    expect(page.textContent!.trim()).toBe(linesOf(SAGE, "handSet.light.bg")[0]);
    expect(q(el, "[data-test=hand-row-bg]").contains(page)).toBe(true);
    expect(rowButton(el, "hand-fix-light-bg")).toBeNull();
  });

  it("two fixes: warns under Text and Sunken areas, counts them closed, and errs nowhere", async () => {
    const el = await mount(TWO_FIXES);
    expect(disclosure(el).summary.endsWith(" · 2 hard to read")).toBe(true);
    expect(disclosure(el).hasAttribute("has-error")).toBe(false);
    await open(el);
    expect(q(el, "[data-test=hand-row-text]").contains(warningLine(el, "light", "text"))).toBe(
      true,
    );
    expect(
      q(el, "[data-test=hand-row-surface-sunken]").contains(
        warningLine(el, "light", "surface-sunken"),
      ),
    ).toBe(true);
    expect(el.shadowRoot!.querySelectorAll("[data-test^=hand-warning-]")).toHaveLength(2);
    for (const key of ["text", "surface-sunken"])
      expect(codeField(el, "light", key).error).toBe("");
    expect(disclosure(el).hasAttribute("has-error")).toBe(false);
  });

  it("a colour drawn both ways shows both sentences", async () => {
    const el = await mount(HOVER);
    await open(el);
    const lines = linesOf(HOVER, "handSet.light.primary-hover");
    expect(lines).toHaveLength(2);
    expect(warningLine(el, "light", "primary-hover")!.textContent!.trim()).toBe(lines.join(" "));
  });

  it("a dark warning says Dark screens under the right rows", async () => {
    const el = await mount(DARK);
    await open(el);
    for (const key of ["bg", "text"]) {
      const line = warningLine(el, "dark", key)!;
      expect(q(el, `[data-test=hand-row-${key}]`).contains(line)).toBe(true);
      expect(line.textContent!.trim().startsWith("Dark screens: ")).toBe(true);
      expect(warningLine(el, "light", key)).toBeNull();
    }
    expect(rowButton(el, "hand-fix-dark-text")!.textContent!.trim()).toBe("Use #bebebe");
    expect(rowButton(el, "hand-fix-dark-bg")).toBeNull();
  });
});

describe("the fixed line", () => {
  const FIXED = { "handSet.light.text-muted": { from: "#8fa898", to: "#526a5b" } };
  const TAKEN = setHand(CREAM, "light", "text-muted", "#526a5b");

  it("says what it was fixed from while the value holds the fix, with Undo", async () => {
    const el = await mount(TAKEN, { fixed: FIXED });
    await open(el);
    const text = q(el, "[data-test=hand-fixed-light-text-muted]");
    expect(text.textContent!.trim()).toBe("Light screens: fixed from #8fa898");
    expect(q(el, "[data-test=hand-row-text-muted]").contains(text)).toBe(true);
    expect(text.nextElementSibling!.textContent!.trim()).toBe("·");
    const undo = rowButton(el, "hand-undo-light-text-muted")!;
    expect(undo.textContent!.trim()).toBe("Undo");
    expect(innerLabel(undo)).toBe("Undo: Secondary text, light screens");
    const seen = actions(el);
    await openFoldsAround(undo);
    await userEvent.click(undo);
    expect(seen).toEqual([{ kind: "undo", mode: "light", key: "text-muted" }]);
  });

  it("is gone once the value is anything else", async () => {
    const other = setHand(CREAM, "light", "text-muted", "#536a5b");
    const el = await mount(other, { fixed: FIXED });
    await open(el);
    expect(el.shadowRoot!.querySelector("[data-test=hand-fixed-light-text-muted]")).toBeNull();
    expect(rowButton(el, "hand-undo-light-text-muted")).toBeNull();
  });

  const words = (el: ThemeAdvanced) => q(el, "[data-test=hand-fixed-light-text-muted]");
  const undo = (el: ThemeAdvanced) => rowButton(el, "hand-undo-light-text-muted")!;

  async function at(el: ThemeAdvanced, width: number) {
    el.style.width = `${width}px`;
    await openFoldsAround(words(el));
    await nextFrame();
    await nextFrame();
    // elementFromPoint sees only what is inside the viewport.
    words(el).scrollIntoView({ block: "center" });
    return dotOf(el.shadowRoot!, words(el), undo(el));
  }

  const wordLines = (el: ThemeAdvanced) => {
    const range = document.createRange();
    range.selectNodeContents(words(el));
    return range.getClientRects().length;
  };

  /**
   * A width at which the fixed words still take one line but Undo no longer fits beside them,
   * measured in this browser's fonts: between the words' end (their end padding included) and
   * Undo's end on a wide line, else the first such width found stepping down from wide.
   */
  async function narrowWidth(el: ThemeAdvanced): Promise<number> {
    const wide = 1000;
    await at(el, wide);
    const left = el.getBoundingClientRect().left;
    const slack =
      el.getBoundingClientRect().right - words(el).parentElement!.getBoundingClientRect().right;
    const wordsEnd = words(el).getBoundingClientRect().right - left;
    const undoEnd = undo(el).getBoundingClientRect().right - left;
    const fits = async (width: number) =>
      !(await at(el, width)).undoOnColourLine && wordLines(el) === 1;
    const between = Math.round((wordsEnd + undoEnd) / 2 + slack);
    if (await fits(between)) return between;
    for (let width = wide; width > 0; width -= 2) if (await fits(width)) return width;
    throw new Error("no width puts Undo below one line of fixed words");
  }

  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`drops the "·" when Undo wraps to a line of its own (${locale})`, async () => {
      setLocale(locale);
      const el = await mount(TAKEN, { fixed: FIXED });
      await open(el);
      const narrow = await at(el, await narrowWidth(el));
      expect(wordLines(el)).toBe(1);
      expect(narrow.undoOnColourLine, JSON.stringify(narrow)).toBe(false);
      expect(narrow.drawn, JSON.stringify(narrow)).toBe(false);
      const wide = await at(el, 1000);
      expect(wide.undoOnColourLine, JSON.stringify(wide)).toBe(true);
      expect(wide.drawn, JSON.stringify(wide)).toBe(true);
      expect(wide.dotOnColourLine, JSON.stringify(wide)).toBe(true);
    });
  }
});

describe("one pick per frame", () => {
  let frames: FrameRequestCallback[];
  let cancel: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pick(el: ThemeAdvanced, colour: string) {
    const input = picker(el, "light", "bg");
    input.value = colour;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  const runFrame = (id: number) => frames[id - 1]!(performance.now());

  it("sends the latest pick once, at the frame", async () => {
    const el = await mount(CREAM);
    await open(el);
    const seen = actions(el);
    const before = frames.length;
    pick(el, "#111111");
    pick(el, "#222222");
    pick(el, "#333333");
    expect(seen).toEqual([]);
    expect(frames.length).toBe(before + 1);
    runFrame(frames.length);
    expect(seen).toEqual([{ kind: "pick", mode: "light", key: "bg", colour: "#333333" }]);
    pick(el, "#444444");
    expect(frames.length).toBe(before + 2);
  });

  it("sends a waiting pick before any other action, and nothing more at the frame", async () => {
    const el = await mount(CREAM);
    await open(el);
    await openFoldsAround(workedOut(el, "light", "bg")!);
    const seen = actions(el);
    const before = frames.length;
    pick(el, "#111111");
    const id = frames.length;
    expect(id).toBe(before + 1);
    // Playwright's click waits on animation frames, which this suite holds back.
    workedOut(el, "light", "bg")!.click();
    expect(seen).toEqual([
      { kind: "pick", mode: "light", key: "bg", colour: "#111111" },
      { kind: "worked-out", mode: "light", key: "bg" },
    ]);
    expect(cancel).toHaveBeenCalledWith(id);
    runFrame(id);
    expect(seen).toHaveLength(2);
  });

  it("sends a waiting pick at once when another colour is picked in the same frame", async () => {
    const el = await mount(CREAM);
    await open(el);
    const seen = actions(el);
    const before = frames.length;
    pick(el, "#111111");
    const other = picker(el, "dark", "surface");
    other.value = "#223344";
    other.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(seen).toEqual([{ kind: "pick", mode: "light", key: "bg", colour: "#111111" }]);
    expect(cancel).toHaveBeenCalledWith(before + 1);
    expect(frames.length).toBe(before + 2);
    runFrame(frames.length);
    expect(seen).toEqual([
      { kind: "pick", mode: "light", key: "bg", colour: "#111111" },
      { kind: "pick", mode: "dark", key: "surface", colour: "#223344" },
    ]);
  });

  it("cancels a waiting frame when removed", async () => {
    const el = await mount(CREAM);
    await open(el);
    const before = frames.length;
    pick(el, "#111111");
    const id = frames.length;
    expect(id).toBe(before + 1);
    el.remove();
    expect(cancel).toHaveBeenCalledWith(id);
  });
});

describe("the Text block", () => {
  const textRows = (el: ThemeAdvanced) =>
    q<HTMLElementTagNameMap["dashboard-theme-text"]>(el, "dashboard-theme-text");

  it("holds the Text block after the colours and before Reset all, under a Text heading", async () => {
    const draft = typeTextSize(openDraft(LUCIA), "sm", "10");
    const el = await mount(draft);
    const d = disclosure(el);
    const heading = q(el, "h3.text-group");
    expect(heading.textContent!.trim()).toBe("Text");
    expect(d.contains(textRows(el))).toBe(true);
    const order = (a: Node, b: Node) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(q(el, ".table"), heading)).toBeTruthy();
    expect(order(heading, textRows(el))).toBeTruthy();
    expect(order(textRows(el), q(el, "[data-test=reset-all]"))).toBeTruthy();
    expect(textRows(el).draft).toBe(draft);
    expect(textRows(el).derived).toBe(el.derived);
  });

  it("passes the text errors and busy to the rows, and passes their changes on", async () => {
    const errors = { "text.size.sm": t("appearance.bad_text_px") };
    const el = await mount(openDraft(LUCIA), { textErrors: errors, busy: true });
    expect(textRows(el).errors).toBe(errors);
    expect(textRows(el).busy).toBe(true);
    const seen: Event[] = [];
    el.parentElement!.addEventListener("text-change", (event) => seen.push(event));
    textRows(el).dispatchEvent(
      new CustomEvent("text-change", {
        detail: { kind: "family", family: "serif" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(seen).toHaveLength(1);
  });

  it("opens itself while a text value holds an error", async () => {
    const el = await mount(openDraft(LUCIA), {
      textErrors: { "text.size.sm": t("appearance.bad_text_px") },
    });
    expect(disclosure(el).hasAttribute("has-error")).toBe(true);
    el.textErrors = {};
    await el.updateComplete;
    expect(disclosure(el).hasAttribute("has-error")).toBe(false);
  });

  it("offers Reset all while only text is set by hand", async () => {
    const el = await mount(setTypeface(openDraft(LUCIA), "serif"));
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=reset-all]").disabled).toBe(false);
  });

  it("names colours and text in its heading and opening line", async () => {
    const el = await mount(openDraft(LUCIA));
    expect(disclosure(el).heading).toBe("Advanced: set colours and text by hand");
    expect(q(el, "[data-test=advanced-intro]").textContent!.trim()).toBe(
      "A colour you set here stays as you set it when you change the brand colour, background or corners. A text size you set here grows and shrinks with Text size. Waitron still checks both can be read.",
    );
  });
});
