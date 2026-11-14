import { expect, it, vi } from "vitest";
import { printGuestMenu } from "./guest-menu-print.js";
it("prints only the captured HTML and removes its frame after printing", async () => {
  let view: Window | undefined;
  const print = vi.fn((value: Window) => {
    view = value;
  });
  printGuestMenu("<!doctype html><h1>Captured menu</h1>", print);
  await expect.poll(() => print.mock.calls.length).toBe(1);
  expect(view!.document.body.textContent).toBe("Captured menu");
  const frame = view!.frameElement!;
  view!.dispatchEvent(new Event("afterprint"));
  expect(frame.isConnected).toBe(false);
});
