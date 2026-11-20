import { afterEach, expect, test, vi } from "vitest";

vi.mock("@waitron/ui", async (original) => ({
  ...(await original<typeof import("@waitron/ui")>()),
  startWithPopover: () => {},
}));
let button: HTMLButtonElement;
afterEach(() => {
  button.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
});

test("a press on any button in the page buzzes once main has run", async () => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  const vibrate = vi.spyOn(navigator, "vibrate").mockReturnValue(true);
  Object.defineProperty(navigator, "maxTouchPoints", { value: 1, configurable: true });
  await import("./main.js");
  button = document.createElement("button");
  document.body.append(button);
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  expect(vibrate.mock.calls).toEqual([[15]]);
});
