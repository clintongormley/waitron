// Not in test-helpers.ts: Stryker runs only the test files that import a mutated file, and nearly
// every test imports test-helpers.ts.
import { onTestFinished } from "vitest";
import { iconButtonStyles, trackIconTooltip } from "./icon-button.js";
import { applyTokens } from "./tokens/index.js";

/** An icon button styled as the shared one, its tooltip below it, pressed and unpressed by a click,
 * and controlling a popover. */
export function iconButton(): {
  button: HTMLButtonElement;
  icon: HTMLElement;
  tooltip: HTMLElement;
  popover: HTMLElement;
} {
  const sheet = iconButtonStyles.styleSheet!;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const popover = document.createElement("div");
  popover.id = "icon-button-popover";
  popover.popover = "auto";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.setAttribute("aria-label", "Select");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("popovertarget", popover.id);
  button.innerHTML = `<span class="icon">S</span><span class="icon-tooltip" aria-hidden="true">Select</span>`;
  button.addEventListener("click", () =>
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true")),
  );
  for (const type of ["pointerenter", "pointerleave", "focus", "blur"])
    button.addEventListener(type, trackIconTooltip);
  const wrapper = document.createElement("div");
  document.body.append(wrapper);
  applyTokens(wrapper);
  wrapper.append(button, popover);
  onTestFinished(() => {
    wrapper.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
  });
  return {
    button,
    icon: button.querySelector<HTMLElement>(".icon")!,
    tooltip: button.querySelector<HTMLElement>(".icon-tooltip")!,
    popover,
  };
}
