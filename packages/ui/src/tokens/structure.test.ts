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
    "--wt-font-size-sm",
    "--wt-font-size-md",
    "--wt-font-size-lg",
    "--wt-tap-min",
    "--wt-opacity-disabled",
    "--wt-dialog-max-width",
  ]) {
    expect(token(el, name), `${name} should be defined`).not.toBe("");
  }
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
  // The bug this guards against: colors.css's `[data-wt-theme-root][data-theme="light"|"dark"]`
  // blocks used plain attribute selectors (specificity 0,2,0) while the base/media defaults were
  // `:where()`-wrapped (specificity 0,0,0). A deployment override like `.brand { --wt-color-primary:
  // purple }` (specificity 0,1,0) beat the base defaults but LOST to the data-theme blocks whenever
  // data-theme was set — which is the shipped workbench's own configuration. The structure-token
  // test above never catches this: structure.css has no data-theme-scoped rules, so a
  // structure-token override wins regardless of data-theme. Only a colour token — which colors.css
  // does define per data-theme — can prove this.
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
