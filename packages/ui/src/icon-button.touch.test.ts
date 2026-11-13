/// <reference types="@vitest/browser-playwright" />
import { afterEach, expect, test, vi } from "vitest";
import { cdp, commands } from "vitest/browser";
import { iconButton } from "./icon-button-test-helpers.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await commands.parkPointer();
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
  expect(matchMedia("(hover: hover)").matches).toBe(false);
  await tap(session, centre(button.getBoundingClientRect()));
  await expect.poll(() => button.getAttribute("aria-pressed")).toBe("true");
  expect(button.matches(":hover")).toBe(true);
  expect.soft(getComputedStyle(tooltip).display).toBe("none");
  await tap(session, tooltipSpot);
  await expect.poll(() => beneathClicks).toBe(1);
  // Chromium clears a tap's :active on a timer; left to fire in the next test, it un-hovers
  // whatever that test hovered.
  await expect.poll(() => beneath.matches(":active")).toBe(false);
});
