/// <reference types="@vitest/browser-playwright" />
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { cdp, commands, userEvent } from "vitest/browser";
import { iconButtonStyles, trackIconTooltip } from "./icon-button.js";
import { applyTokens } from "./tokens/index.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await commands.parkPointer();
});

function trackedButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Filters";
  for (const type of ["pointerenter", "pointerleave", "focus", "blur"])
    button.addEventListener(type, trackIconTooltip);
  document.body.append(button);
  onTestFinished(() => button.remove());
  return button;
}

test("Escape hides the tooltip of a hovered icon button", async () => {
  const button = trackedButton();
  await userEvent.hover(button);
  await userEvent.keyboard("{Escape}");
  expect(button.hasAttribute("data-tooltip-hidden")).toBe(true);
});

test("an icon button removed while hovered stops listening for Escape", async () => {
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const button = trackedButton();
  await userEvent.hover(button);
  const escape = added.mock.calls.find(([type]) => type === "keydown")![1];
  button.remove();
  await userEvent.keyboard("{Escape}");
  expect(button.hasAttribute("data-tooltip-hidden")).toBe(false);
  expect(removed).toHaveBeenCalledWith("keydown", escape, true);
});

/** An icon button styled as the shared one, its tooltip below it, pressed and unpressed by a click,
 * and controlling a popover. */
function iconButton(): {
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

test("a click on an icon button's shown tooltip does not press the button", async () => {
  const { button, tooltip, popover } = iconButton();
  await userEvent.hover(button);
  expect(getComputedStyle(tooltip).display).toBe("block");
  await userEvent.click(tooltip);
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(popover.matches(":popover-open")).toBe(false);
});

test("a click on an icon button's icon, and Enter on it, still press it", async () => {
  const { button, icon, popover } = iconButton();
  await userEvent.hover(button);
  await userEvent.click(icon);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(popover.matches(":popover-open")).toBe(true);
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

/** Taps the top window's viewport point under `point`, which is in this test frame's coordinates. */
async function tap(
  session: ReturnType<typeof cdp>,
  point: { x: number; y: number },
): Promise<void> {
  const frame = window.frameElement!.getBoundingClientRect();
  const scale = frame.width / window.innerWidth;
  const touch = { x: frame.left + point.x * scale, y: frame.top + point.y * scale };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

test("on a touch screen a tapped icon button shows no tooltip over what lies beneath it", async () => {
  const { button, tooltip } = iconButton();
  button.removeAttribute("popovertarget");
  const beneath = document.createElement("button");
  beneath.style.display = "block";
  beneath.style.inlineSize = "20em";
  beneath.style.blockSize = "4em";
  let beneathClicks = 0;
  beneath.addEventListener("click", () => beneathClicks++);
  button.parentElement!.append(beneath);
  tooltip.style.display = "block";
  const tooltipSpot = centre(tooltip.getBoundingClientRect());
  tooltip.style.removeProperty("display");
  expect(document.elementFromPoint(tooltipSpot.x, tooltipSpot.y)).toBe(beneath);

  const session = cdp();
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "hover", value: "none" },
      { name: "pointer", value: "coarse" },
    ],
  });
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    expect(matchMedia("(hover: hover)").matches).toBe(false);
    await tap(session, centre(button.getBoundingClientRect()));
    await expect.poll(() => button.getAttribute("aria-pressed")).toBe("true");
    // The tap leaves the button hovered, which is what used to keep its tooltip up.
    expect(button.matches(":hover")).toBe(true);
    expect.soft(getComputedStyle(tooltip).display).toBe("none");
    await tap(session, tooltipSpot);
    await expect.poll(() => beneathClicks).toBe(1);
    // Chromium clears a tap's :active on a timer; left to fire in the next test, it un-hovers
    // whatever that test hovered.
    await expect.poll(() => beneath.matches(":active")).toBe(false);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
});
