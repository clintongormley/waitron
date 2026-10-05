import { expect, test, afterEach } from "vitest";
import { mountTokenRoot, token } from "./token-test-helpers.js";

let host: HTMLElement;
let overrideSheet: CSSStyleSheet | undefined;

afterEach(() => {
  host?.remove();
  // Clean up the override sheet so it cannot leak into other test files.
  if (overrideSheet) {
    const stale = overrideSheet;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== stale);
    overrideSheet = undefined;
  }
});

function mount(): HTMLElement {
  host = mountTokenRoot();
  return host;
}

test("defines the structural contract", () => {
  const el = mount();
  for (const name of [
    "--wt-space-1",
    "--wt-space-2",
    "--wt-space-3",
    "--wt-space-4",
    "--wt-space-5",
    "--wt-radius-sm",
    "--wt-radius-md",
    "--wt-radius-lg",
    "--wt-radius-full",
    "--wt-font-family",
    "--wt-font-family-mono",
    "--wt-font-family-google",
    "--wt-font-weight-medium",
    "--wt-google-mark-size",
    "--wt-google-mark-gap",
    "--wt-google-button-line-height",
    "--wt-font-size-sm",
    "--wt-font-size-md",
    "--wt-font-size-lg",
    "--wt-tap-min",
    "--wt-opacity-disabled",
    "--wt-opacity-hover",
    "--wt-dialog-max-width",
    "--wt-modal-max-width",
    "--wt-modal-compact-width",
    "--wt-modal-standard-width",
    "--wt-modal-inline-margin",
    "--wt-modal-inline-padding",
    "--wt-form-max-width",
    "--wt-field-max-width",
    "--wt-cell-name-max-width",
    "--wt-stepper-field-width",
    "--wt-stepper-button-width",
    "--wt-price-field-width",
    "--wt-duration-fade",
    "--wt-duration-move",
    "--wt-duration-disclosure",
    "--wt-field-height",
    "--wt-field-line-width",
    "--wt-field-line-width-active",
    "--wt-dropdown-row-height",
  ]) {
    expect(token(el, name), `${name} should be defined`).not.toBe("");
  }
});

test("the type scale is 12px small, 14px body, 18px large and 22px extra large", () => {
  const el = mount();
  const probe = document.createElement("span");
  el.appendChild(probe);
  const size = (name: string) => {
    probe.style.fontSize = `var(${name})`;
    return getComputedStyle(probe).fontSize;
  };
  expect(size("--wt-font-size-sm")).toBe("12px");
  expect(size("--wt-font-size-md")).toBe("14px");
  expect(size("--wt-font-size-lg")).toBe("18px");
  expect(size("--wt-font-size-xl")).toBe("22px");
});

test("the Google button sets Google Sans Medium on 20px lines, with a 20px mark 10px from its label", () => {
  const el = mount();
  const probe = document.createElement("span");
  probe.style.display = "block";
  probe.style.fontFamily = "var(--wt-font-family-google)";
  probe.style.fontWeight = "var(--wt-font-weight-medium)";
  probe.style.width = "var(--wt-google-mark-size)";
  probe.style.columnGap = "var(--wt-google-mark-gap)";
  probe.style.lineHeight = "var(--wt-google-button-line-height)";
  el.appendChild(probe);
  const style = getComputedStyle(probe);
  expect(style.fontFamily).toMatch(/^"Google Sans", /);
  expect(style.fontFamily.replace(/^"Google Sans", /, "")).toBe(token(el, "--wt-font-family"));
  expect(style.fontWeight).toBe("500");
  expect(style.width).toBe("20px");
  expect(style.columnGap).toBe("10px");
  expect(style.lineHeight).toBe("20px");
});

test("dialog max width is 48rem, capped at 90% of the viewport", () => {
  const el = mount();
  expect(token(el, "--wt-dialog-max-width")).toBe("min(90vw, 48rem)");
});

test("the wide modal is 64rem wide, and a dialog keeps its own 48rem", () => {
  const el = mount();
  expect(token(el, "--wt-modal-max-width")).toBe("64rem");
  el.style.setProperty("--wt-modal-max-width", "10rem");
  expect(token(el, "--wt-dialog-max-width")).toBe("min(90vw, 48rem)");
});

test("a modal's form is 36rem wide, and a field outside a modal has no cap", () => {
  const el = mount();
  expect(token(el, "--wt-form-max-width")).toBe("36rem");
  expect(token(el, "--wt-field-max-width")).toBe("none");
});

test("a modal's form is narrower than the modal, and wider than a phone", () => {
  // Wider than a 390px phone, so a phone's modal gives its fields its whole width as before; narrower
  // than the standard modal, or capping a field in one would change nothing.
  const el = mount();
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  el.appendChild(probe);
  const px = (length: string) => {
    probe.style.width = length;
    return probe.getBoundingClientRect().width;
  };
  expect(px("var(--wt-form-max-width)")).toBeGreaterThan(390);
  expect(px("var(--wt-form-max-width)")).toBeLessThan(px("var(--wt-modal-max-width)"));
});

/** Resolves a length to pixels inside a token root. */
function lengthPx(el: HTMLElement, length: string): number {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.width = length;
  el.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

test("the modal sizes run compact, then standard, then wide", () => {
  const el = mount();
  const compact = lengthPx(el, "var(--wt-modal-compact-width)");
  const standard = lengthPx(el, "var(--wt-modal-standard-width)");
  const wide = lengthPx(el, "var(--wt-modal-max-width)");
  expect(compact).toBe(448);
  expect(standard).toBe(672);
  expect(compact).toBeLessThan(standard);
  expect(standard).toBeLessThan(wide);
});

test("a standard modal holds a form at the form width beside a classic scrollbar", () => {
  // The dialog is border-box with a 1px border each side and --wt-space-5 of inline padding at its
  // widest; 17px is the widest classic scrollbar, and a long editor's body always scrolls.
  const el = mount();
  const content =
    lengthPx(el, "var(--wt-modal-standard-width)") -
    2 * 1 -
    2 * lengthPx(el, "var(--wt-space-5)") -
    17;
  expect(content).toBeGreaterThanOrEqual(lengthPx(el, "var(--wt-form-max-width)"));
});

test("a name cell may grow wider than the controls that sit beside it", () => {
  // The cap exists to make a long name WRAP, not to squeeze the row: a value at or below the tap
  // minimum would make the name column narrower than the switch or menu button next to it, which is
  // the opposite of what it is for.
  const el = mount();
  expect(parseInt(token(el, "--wt-cell-name-max-width"), 10)).toBeGreaterThan(
    parseInt(token(el, "--wt-tap-min"), 10),
  );
});

test("a stepper's number box is never narrower than the tap target", () => {
  // The box is what a wt-number-stepper hands focus to, so it is held to the tap minimum.
  const el = mount();
  expect(parseInt(token(el, "--wt-stepper-field-width"), 10)).toBeGreaterThanOrEqual(
    parseInt(token(el, "--wt-tap-min"), 10),
  );
});

test("a stepper's buttons are 24px wide, WCAG 2.2's level AA minimum target", () => {
  const el = mount();
  expect(token(el, "--wt-stepper-button-width")).toBe("24px");
});

test("the narrowest stepper box is 88px", () => {
  const el = mount();
  expect(token(el, "--wt-stepper-field-width")).toBe("88px");
});

test("a field box is never shorter than the tap target", () => {
  const el = mount();
  expect(parseInt(token(el, "--wt-field-height"), 10)).toBeGreaterThanOrEqual(
    parseInt(token(el, "--wt-tap-min"), 10),
  );
});

test("minimum tap target is at least 44px", () => {
  const el = mount();
  const tap = parseInt(token(el, "--wt-tap-min"), 10);
  expect(tap).toBeGreaterThanOrEqual(44);
});

test("disabled opacity is a valid, visibly-dimmed opacity value", () => {
  // Strictly between 0 and 1: 0 would hide a disabled control entirely (it must stay visible,
  // just dimmed), and 1 would give disabled controls no visual distinction at all.
  const el = mount();
  const opacity = Number(token(el, "--wt-opacity-disabled"));
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
});

test("hover opacity is a valid, visibly-dimmed opacity value", () => {
  // Same reasoning as the disabled-opacity test above: strictly between 0 and 1 so a hovered
  // control stays visible (not hidden) but visibly distinct from its resting state.
  const el = mount();
  const opacity = Number(token(el, "--wt-opacity-hover"));
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
});

test("deployment rules override the token layer's defaults", () => {
  const el = mount();
  el.classList.add("wt-structure-override-target");

  // First, prove the token layer itself is supplying the default value.
  // Without this, the override assertion below would pass even if the
  // token layer defined nothing at all.
  expect(token(el, "--wt-radius-md")).toBe("8px");

  // Then prove a selector-based deployment rule — the way retheming
  // actually works (see "Retheming a deployment" in
  // docs/developers/design-system.md, e.g. `#app { --wt-radius-md: 0px; }`)
  // — overrides that default. This must be a stylesheet rule competing with
  // the `:where()`-wrapped token definitions, not an inline style: an
  // inline style always wins for a custom property regardless of whether
  // any rule defines it, so it can't distinguish "a deployment override
  // beats the token layer" from "there is no token layer at all".
  overrideSheet = new CSSStyleSheet();
  overrideSheet.replaceSync(".wt-structure-override-target { --wt-radius-md: 0px; }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, overrideSheet];

  expect(token(el, "--wt-radius-md")).toBe("0px");
});

test("deployment rules override the token layer's defaults even when data-theme is set", () => {
  // A deployment override like `.brand { --wt-color-primary: purple }` (specificity 0,1,0) must
  // beat colors.css's data-theme blocks while data-theme is set. The structure-token test above
  // never catches this: structure.css has no data-theme-scoped rules. Only a colour token — which
  // colors.css does define per data-theme — can prove this.
  const el = mount();
  el.classList.add("wt-color-override-target");
  el.setAttribute("data-theme", "light");

  // First, prove the token layer itself is supplying the default value for this theme.
  expect(token(el, "--wt-color-primary")).toBe("#1f6feb");

  overrideSheet = new CSSStyleSheet();
  overrideSheet.replaceSync(".wt-color-override-target { --wt-color-primary: purple; }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, overrideSheet];

  expect(token(el, "--wt-color-primary")).toBe("purple");

  // And the override must keep winning under the dark theme too — not just light.
  el.setAttribute("data-theme", "dark");
  expect(token(el, "--wt-color-primary")).toBe("purple");
});
