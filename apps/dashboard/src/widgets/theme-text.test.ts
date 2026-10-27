import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, type TextScale, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { es } from "../i18n/strings.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { openDraft, type LookDraft } from "./look-draft.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { TextAction, ThemeTextRows } from "./theme-text.js";
import "./theme-text.js";

beforeEach(() => setLocale("en-GB"));

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

function draftOf(text: ThemeChoices["text"] = {}, textScale: TextScale = 100): LookDraft {
  return openDraft({ ...WAITRON_CHOICES, textScale, text });
}

async function mount(draft: LookDraft, extra: Partial<ThemeTextRows> = {}) {
  const { el } = await mountWidget<ThemeTextRows>("dashboard-theme-text", {
    draft,
    derived: deriveTheme(draft.choices),
    ...extra,
  });
  return el;
}

const q = <T extends Element = HTMLElement>(el: ThemeTextRows, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const all = <T extends Element = HTMLElement>(el: ThemeTextRows, selector: string) => [
  ...el.shadowRoot!.querySelectorAll<T>(selector),
];
const stepper = (el: ThemeTextRows, key: string) =>
  q<HTMLElementTagNameMap["wt-number-stepper"]>(el, `wt-number-stepper[name="text.size.${key}"]`)!;
const combobox = (el: ThemeTextRows, name: string) =>
  q<HTMLElementTagNameMap["wt-combobox"]>(el, `wt-combobox[name="${name}"]`)!;
const status = (el: ThemeTextRows, row: string) =>
  q(el, `[data-test="text-status-${row}"]`)!.textContent!.trim();
const workedOut = (el: ThemeTextRows, row: string) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test="text-worked-out-${row}"]`);
const stepLine = (el: ThemeTextRows, key: string) => q(el, `[data-test="text-step-size.${key}"]`);

function actions(el: ThemeTextRows): TextAction[] {
  const seen: TextAction[] = [];
  el.addEventListener("text-change", (event) =>
    seen.push((event as CustomEvent<TextAction>).detail),
  );
  return seen;
}

describe("the Text rows", () => {
  it("draws the eight rows in order, each with its control", async () => {
    const el = await mount(draftOf());
    expect(all(el, ".row .name").map((name) => name.textContent!.trim())).toEqual([
      "Typeface",
      "Small text",
      "Normal text",
      "Large text",
      "Largest text",
      "Normal weight",
      "Medium weight",
      "Bold weight",
    ]);
    const family = combobox(el, "text.family");
    expect(family.options.map((option) => option.label)).toEqual(["The device's own", "Serif"]);
    expect(family.hideLabel).toBe(true);
    expect(family.label).toBe("Typeface");
    expect(family.search).toBe("never");
    const weights = all<HTMLElementTagNameMap["wt-combobox"]>(
      el,
      'wt-combobox[name^="text.weight."]',
    );
    expect(weights.map((box) => box.name)).toEqual([
      "text.weight.normal",
      "text.weight.medium",
      "text.weight.bold",
    ]);
    for (const box of [family, ...weights]) {
      expect([box.hideLabel, box.search, box.stableWidth], box.name).toEqual([true, "never", true]);
    }
    expect(weights.map((box) => box.label)).toEqual([
      "Normal weight",
      "Medium weight",
      "Bold weight",
    ]);
    for (const box of weights) {
      expect(box.options.map((option) => option.label)).toEqual([
        "400",
        "500",
        "600",
        "700",
        "800",
      ]);
    }
    const steppers = all<HTMLElementTagNameMap["wt-number-stepper"]>(
      el,
      'wt-number-stepper[name^="text.size."]',
    );
    expect(steppers.map((box) => box.name)).toEqual([
      "text.size.sm",
      "text.size.md",
      "text.size.lg",
      "text.size.xl",
    ]);
    for (const box of steppers) {
      expect([box.min, box.max, box.hideLabel]).toEqual([8, 40, true]);
      const unit = box.nextElementSibling as HTMLElement;
      expect(unit.textContent!.trim()).toBe("px");
      expect(unit.getAttribute("aria-hidden")).toBe("true");
    }
    expect(stepper(el, "sm").label).toBe("Small text, in pixels");
    const buttons = stepper(el, "sm").shadowRoot!.querySelectorAll("button");
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Decrease Small text, in pixels");
    expect(buttons[1]!.getAttribute("aria-label")).toBe("Increase Small text, in pixels");
  });

  it("names the steppers' buttons and the typeface's choices in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(draftOf());
    const label = fill("appearance.text_px_label", { name: es["appearance.text.size.sm"] });
    expect(stepper(el, "sm").label).toBe(label);
    const minus = stepper(el, "sm").shadowRoot!.querySelector("button")!;
    expect(minus.getAttribute("aria-label")).toBe(fill("action.decrease", { label }));
    expect(minus.getAttribute("aria-label")).toBe("Reducir Texto pequeño, en píxeles");
    expect(combobox(el, "text.family").options.map((option) => option.label)).toEqual([
      es["appearance.typeface.system"],
      es["appearance.typeface.serif"],
    ]);
  });

  it("a worked-out row shows Waitron's value and says Worked out, not bold", async () => {
    const el = await mount(draftOf());
    expect(["sm", "md", "lg", "xl"].map((key) => stepper(el, key).value)).toEqual([
      "12",
      "14",
      "18",
      "22",
    ]);
    expect(
      ["normal", "medium", "bold"].map((key) => combobox(el, `text.weight.${key}`).value),
    ).toEqual(["400", "500", "600"]);
    expect(combobox(el, "text.family").value).toBe("system");
    for (const row of ["family", "size.sm", "weight.bold"]) {
      expect(status(el, row)).toBe("Worked out");
      expect(workedOut(el, row)).toBeNull();
    }
    const bold = getComputedStyle(el).getPropertyValue("--wt-font-weight-bold").trim();
    const input = stepper(el, "sm").shadowRoot!.querySelector("input")!;
    expect(getComputedStyle(input).fontWeight).not.toBe(bold);
  });

  it("a hand-set row is bold, tagged Set by hand, with its Use worked-out link", async () => {
    const el = await mount(draftOf({ family: "serif", size: { sm: 10 }, weight: { bold: 800 } }));
    expect(stepper(el, "sm").value).toBe("10");
    expect(combobox(el, "text.family").value).toBe("serif");
    expect(combobox(el, "text.weight.bold").value).toBe("800");
    const bold = getComputedStyle(el).getPropertyValue("--wt-font-weight-bold").trim();
    const input = stepper(el, "sm").shadowRoot!.querySelector("input")!;
    expect(getComputedStyle(input).fontWeight).toBe(bold);
    const md = stepper(el, "md").shadowRoot!.querySelector("input")!;
    expect(getComputedStyle(md).fontWeight).not.toBe(bold);
    const family = combobox(el, "text.family").shadowRoot!.querySelector<HTMLElement>(
      "[part=field]",
    )!;
    expect(getComputedStyle(family).fontWeight).toBe(bold);
    for (const [row, words] of [
      ["family", "Use worked-out typeface"],
      ["size.sm", "Use worked-out size"],
      ["weight.bold", "Use worked-out weight"],
    ] as const) {
      expect(status(el, row)).toBe("Set by hand");
      expect(workedOut(el, row)!.textContent!.trim()).toBe(words);
    }
    expect(workedOut(el, "size.sm")!.getAttribute("aria-label")).toBe(
      "Use worked-out size: Small text",
    );
    expect(status(el, "size.md")).toBe("Worked out");
  });

  it("a typed size that is not valid shows as typed and counts as set by hand", async () => {
    const draft = { ...draftOf(), textCodes: { lg: "x" } };
    const el = await mount(draft);
    expect(stepper(el, "lg").value).toBe("x");
    expect(status(el, "size.lg")).toBe("Set by hand");
  });

  it("shows the step's size under every size row away from 100%", async () => {
    const at115 = await mount(draftOf({ size: { sm: 10 } }, 115));
    expect(stepLine(at115, "md")!.textContent!.trim()).toBe("at 115%: 16 px");
    expect(stepLine(at115, "sm")!.textContent!.trim()).toBe("at 115%: 12 px");
    expect(stepLine(at115, "xl")!.textContent!.trim()).toBe("at 115%: 25 px");
    cleanupWidgets();
    const at100 = await mount(draftOf({ size: { sm: 10 } }));
    for (const key of ["sm", "md", "lg", "xl"]) expect(stepLine(at100, key)).toBeNull();
  });

  it("each control sends its change", async () => {
    const el = await mount(draftOf());
    const seen = actions(el);
    await chooseOption(combobox(el, "text.family"), "serif");
    const input = stepper(el, "sm").shadowRoot!.querySelector("input")!;
    await userEvent.clear(input);
    await userEvent.type(input, "9");
    await userEvent.click(stepper(el, "md").shadowRoot!.querySelectorAll("button")[1]!);
    await chooseOption(combobox(el, "text.weight.bold"), "800");
    expect(seen).toEqual([
      { kind: "family", family: "serif" },
      { kind: "size", key: "sm", text: "" },
      { kind: "size", key: "sm", text: "9" },
      { kind: "size", key: "md", text: "15" },
      { kind: "weight", key: "bold", weight: 800 },
    ]);
    seen.length = 0;
    el.draft = draftOf({ family: "serif", size: { lg: 20 }, weight: { medium: 700 } });
    await el.updateComplete;
    for (const row of ["family", "size.lg", "weight.medium"]) {
      await userEvent.click(workedOut(el, row)!);
    }
    expect(seen).toEqual([
      { kind: "worked-out", field: "text.family" },
      { kind: "worked-out", field: "text.size.lg" },
      { kind: "worked-out", field: "text.weight.medium" },
    ]);
  });

  it("keeps each control's own change event inside the rows", async () => {
    const el = await mount(draftOf());
    const escaped: Event[] = [];
    el.parentElement!.addEventListener("wt-change", (event) => escaped.push(event));
    await chooseOption(combobox(el, "text.family"), "serif");
    await chooseOption(combobox(el, "text.weight.bold"), "800");
    await userEvent.click(stepper(el, "md").shadowRoot!.querySelectorAll("button")[1]!);
    expect(escaped).toEqual([]);
  });

  it("sends no change for a weight or typeface outside the lists", async () => {
    const el = await mount(draftOf());
    const seen = actions(el);
    await chooseOption(combobox(el, "text.weight.bold"), "650");
    await chooseOption(combobox(el, "text.family"), "comic");
    expect(seen).toEqual([]);
  });

  it("an error shows under its row and marks the control", async () => {
    const el = await mount(draftOf(), {
      errors: {
        "text.size.sm": t("appearance.bad_text_px"),
        "text.weight.bold": t("appearance.bad_text_choice"),
      },
    });
    expect(stepper(el, "sm").error).toBe("Enter a whole number from 8 to 40.");
    expect(stepper(el, "md").error).toBe("");
    expect(combobox(el, "text.weight.bold").error).toBe("Pick one of the choices in the list.");
    expect(combobox(el, "text.family").error).toBe("");
  });

  it("busy disables every control and link", async () => {
    const el = await mount(draftOf({ family: "serif", size: { sm: 10 }, weight: { bold: 800 } }), {
      busy: true,
    });
    for (const box of all<HTMLElement & { disabled: boolean }>(
      el,
      "wt-combobox, wt-number-stepper",
    )) {
      expect(box.disabled, box.getAttribute("name")!).toBe(true);
    }
    for (const row of ["family", "size.sm", "weight.bold"]) {
      expect(workedOut(el, row)!.disabled, row).toBe(true);
    }
  });
});

describe("the Text rows' layout", () => {
  const restore = { width: innerWidth, height: innerHeight };
  afterEach(async () => {
    await page.viewport(restore.width, restore.height);
  });
  const box = (el: Element) => el.getBoundingClientRect();

  async function rowAt(container: number) {
    const el = await mount(draftOf({ size: { md: 16 } }));
    el.style.width = `${container}px`;
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const row = q(el, '[data-test="text-row-size.md"]')!;
    return {
      name: row.querySelector<HTMLElement>(".name")!,
      value: row.querySelector<HTMLElement>(".value")!,
    };
  }

  async function sizeLineAt(width: number, error: string) {
    const el = await mount(draftOf({ size: { sm: 14 } }), {
      errors: error === "" ? {} : { "text.size.sm": error },
    });
    el.style.width = `${width}px`;
    await el.updateComplete;
    await stepper(el, "sm").updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const row = q(el, '[data-test="text-row-size.sm"]')!;
    return {
      field: stepper(el, "sm").shadowRoot!.querySelector("[part=field]")!,
      px: row.querySelector('.size > [aria-hidden="true"]')!,
      tag: q(el, '[data-test="text-status-size.sm"]')!,
      gap: parseFloat(getComputedStyle(row.querySelector(".size")!).columnGap),
    };
  }
  const middle = (rect: DOMRect) => (rect.top + rect.bottom) / 2;

  for (const [viewport, width] of [
    [1280, 800],
    [390, 300],
  ] as const) {
    for (const error of ["", "Enter a whole number from 8 to 40."]) {
      it(`at ${viewport} px, "px" sits beside the size box and centred on it, ${error ? "with" : "without"} an error, and the tag stays on the box's line`, async () => {
        await page.viewport(viewport, 900);
        const { field, px, tag, gap } = await sizeLineAt(width, error);
        expect(box(px).left - box(field).right).toBeGreaterThanOrEqual(gap - 1);
        expect(box(px).left - box(field).right).toBeLessThanOrEqual(gap + 1);
        expect(Math.abs(middle(box(px)) - middle(box(field)))).toBeLessThanOrEqual(2);
        expect(box(tag).left).toBeGreaterThan(box(px).right);
        expect(Math.abs(middle(box(tag)) - middle(box(field)))).toBeLessThanOrEqual(2);
      });
    }
  }

  it("at 390 px in Spanish with saved Small text 18 at 130%, a size's error wraps inside its row", async () => {
    setLocale("es-ES");
    await page.viewport(390, 900);
    const choices = { ...WAITRON_CHOICES, textScale: 130 as const, text: { size: { sm: 18 } } };
    const derived = deriveTheme(choices);
    const { el, host } = await mountWidget<ThemeTextRows>(
      "dashboard-theme-text",
      {
        draft: openDraft(choices),
        derived,
        errors: { "text.size.sm": t("appearance.bad_text_px") },
      },
      "light",
    );
    for (const [token, value] of Object.entries(derived.light)) {
      host.style.setProperty(token, String(value));
    }
    el.style.width = "300px";
    await el.updateComplete;
    await stepper(el, "sm").updateComplete;
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const error = stepper(el, "sm").shadowRoot!.querySelector("[data-error]")!;
    expect(error.textContent).toBe(es["appearance.bad_text_px"]);
    const words = document.createRange();
    words.selectNodeContents(error);
    const row = box(q(el, '[data-test="text-row-size.sm"]')!);
    expect(words.getBoundingClientRect().right).toBeLessThanOrEqual(row.right + 1);
  });

  it("at phone width each row puts the value under its name", async () => {
    await page.viewport(390, 900);
    const { name, value } = await rowAt(390);
    expect(box(value).top).toBeGreaterThanOrEqual(box(name).bottom);
  });

  it("when wide each row puts the value beside its name", async () => {
    await page.viewport(1280, 900);
    const { name, value } = await rowAt(800);
    expect(box(value).left).toBeGreaterThanOrEqual(box(name).right);
    expect(box(value).top).toBeLessThan(box(name).bottom);
  });

  it("when wide starts the values where Advanced's colour rows start their Light column", async () => {
    await page.viewport(1280, 900);
    const { name, value } = await rowAt(800);
    const gap = parseFloat(getComputedStyle(value.parentElement!).columnGap);
    // The colour rows split the width 1 : 1.5 : 1.5 between two gaps.
    expect(
      Math.abs(box(value).left - box(name).left - ((800 - 2 * gap) / 4 + gap)),
    ).toBeLessThanOrEqual(1);
  });
});

describe("under a size row", () => {
  const warning = (el: ThemeTextRows, key: string) =>
    q(el, `[data-test="text-warning-size.${key}"]`);
  const note = (el: ThemeTextRows, key: string) => q(el, `[data-test="text-note-size.${key}"]`);
  const fix = (el: ThemeTextRows, key: string) =>
    q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test="text-fix-size.${key}"]`);

  it("Small text set by hand to 10 at 100% warns, with its fix", async () => {
    const el = await mount(draftOf({ size: { sm: 10 } }));
    const line = warning(el, "sm")!;
    expect(line.textContent!.trim()).toBe(
      "Small text: 10 px is smaller than 12 px; text that small is often hard to read.",
    );
    const paragraph = line.closest("p")!;
    expect(paragraph.classList.contains("warning")).toBe(true);
    expect(paragraph.querySelector("wt-icon")!.getAttribute("name")).toBe("warning");
    const warned = document.createElement("span");
    warned.style.color = "var(--wt-color-warning)";
    paragraph.append(warned);
    expect(getComputedStyle(paragraph).color).toBe(getComputedStyle(warned).color);
    warned.remove();
    const button = fix(el, "sm")!;
    expect(button.textContent!.trim()).toBe("Use 12 px");
    expect(button.getAttribute("aria-label")).toBe("Use 12 px: Small text");
    const seen = actions(el);
    await userEvent.click(button);
    expect(seen).toEqual([{ kind: "fix", key: "sm", px: 12 }]);
    expect(note(el, "sm")).toBeNull();
    for (const key of ["md", "lg", "xl"]) expect(warning(el, key)).toBeNull();
  });

  it("at 130%, Largest text set by hand to 25 draws 33 px, above 29, and gets a note, not a warning", async () => {
    const el = await mount(draftOf({ size: { xl: 25 } }, 130));
    const line = note(el, "xl")!;
    expect(line.textContent!.trim()).toBe(
      "Largest text: 33 px is larger than Waitron checks the tills at; long names may wrap more or be cut off.",
    );
    const paragraph = line.closest("p")!;
    expect(paragraph.querySelector("wt-icon")).toBeNull();
    expect(paragraph.classList.contains("warning")).toBe(false);
    const muted = document.createElement("span");
    muted.style.color = "var(--wt-color-text-muted)";
    paragraph.append(muted);
    expect(getComputedStyle(paragraph).color).toBe(getComputedStyle(muted).color);
    muted.remove();
    expect(warning(el, "xl")).toBeNull();
    const button = fix(el, "xl")!;
    expect(button.textContent!.trim()).toBe("Use 22 px (29 px at 130%)");
    const seen = actions(el);
    await userEvent.click(button);
    expect(seen).toEqual([{ kind: "fix", key: "xl", px: 22 }]);
  });

  it("at 130%, Small text set by hand to 8 draws 10 px and offers 9", async () => {
    const el = await mount(draftOf({ size: { sm: 8 } }, 130));
    expect(fix(el, "sm")!.textContent!.trim()).toBe("Use 9 px (12 px at 130%)");
    expect(fix(el, "sm")!.getAttribute("aria-label")).toBe(
      "Use 9\u00a0px (12\u00a0px at 130%): Small text",
    );
  });

  it("takes the warning from the theme's answer, not from the draft", async () => {
    const warned = await mount(draftOf({ size: { sm: 14 } }), {
      derived: deriveTheme(draftOf({ size: { sm: 10 } }).choices),
    });
    expect(warning(warned, "sm")).not.toBeNull();
    cleanupWidgets();
    const quiet = await mount(draftOf({ size: { sm: 10 } }), {
      derived: deriveTheme(draftOf().choices),
    });
    expect(warning(quiet, "sm")).toBeNull();
  });

  it("a Small text fixed to 9 warns again when the step moves", async () => {
    const el = await mount(draftOf({ size: { sm: 9 } }, 130));
    expect(warning(el, "sm")).toBeNull();
    expect(fix(el, "sm")).toBeNull();
    for (const [step, words] of [
      [100, "Use 12 px"],
      [105, "Use 11 px (12 px at 105%)"],
      [115, "Use 10 px (12 px at 115%)"],
    ] as const) {
      const draft = draftOf({ size: { sm: 9 } }, step);
      el.draft = draft;
      el.derived = deriveTheme(draft.choices);
      await el.updateComplete;
      expect(fix(el, "sm")!.textContent!.trim(), String(step)).toBe(words);
    }
  });

  it("Waitron's own sizes at 130% show no warning and no note", async () => {
    const el = await mount(draftOf({}, 130));
    for (const key of ["sm", "md", "lg", "xl"]) {
      expect(warning(el, key)).toBeNull();
      expect(note(el, key)).toBeNull();
      expect(fix(el, key)).toBeNull();
    }
  });

  it("busy disables a fix", async () => {
    const el = await mount(draftOf({ size: { sm: 10 } }), { busy: true });
    expect(fix(el, "sm")!.disabled).toBe(true);
  });
});
