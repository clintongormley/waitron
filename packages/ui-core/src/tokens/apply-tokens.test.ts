import { afterEach, expect, test } from "vitest";
import { applyTokens } from "./index.js";
import { token } from "./token-test-helpers.js";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

function root(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  mounted.push(el);
  return el;
}

test("marks a theme root with a bare attribute, carrying no value of its own", () => {
  const el = root();
  applyTokens(el);
  expect(el.getAttribute("data-wt-theme-root")).toBe("");
});

test("the token layer is added once, however many roots ask for it", () => {
  const first = root();
  applyTokens(first);
  const adopted = document.adoptedStyleSheets.length;
  // Installed, not merely not-duplicated: a count that never grows is also what skipping the
  // install altogether looks like, so the tokens have to be shown resolving on the root as well.
  expect(adopted).toBeGreaterThanOrEqual(1);
  expect(token(first, "--wt-space-2")).not.toBe("");
  applyTokens(root());
  applyTokens(root());
  expect(document.adoptedStyleSheets.length).toBe(adopted);
});

test("a root inside a shadow root gets the tokens in that shadow root, not the document", () => {
  const shadow = root().attachShadow({ mode: "open" });
  const inner = document.createElement("div");
  shadow.append(inner);
  applyTokens(inner);
  expect(shadow.adoptedStyleSheets.length).toBe(1);
  // The wrapper holding the shadow root was never made a theme root itself, so it defines nothing
  // for the inner element to inherit; the property resolves only because the sheet landed on the
  // shadow root. (Custom properties DO cross a shadow boundary by inheritance from the host, so a
  // themed host would make this assertion pass either way.)
  expect(token(inner, "--wt-space-2")).not.toBe("");
});
