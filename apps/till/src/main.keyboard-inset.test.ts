import { afterEach, expect, test, vi } from "vitest";

vi.mock("@waitron/ui", async (original) => ({
  ...(await original<typeof import("@waitron/ui")>()),
  startWithPopover: () => {},
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--wt-keyboard-inset");
  document.documentElement.style.removeProperty("--wt-keyboard-top");
});

test("once main has run, a keyboard covering the page sets the keyboard inset on the page", async () => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  await import("./main.js");
  vi.spyOn(VisualViewport.prototype, "height", "get").mockReturnValue(innerHeight - 300);
  vi.spyOn(VisualViewport.prototype, "offsetTop", "get").mockReturnValue(0);
  window.visualViewport!.dispatchEvent(new Event("resize"));
  expect(document.documentElement.style.getPropertyValue("--wt-keyboard-inset")).toBe("300px");
});
