import { afterEach, expect, test, vi } from "vitest";
import { startWithPopover } from "./popover-startup.js";

import { commands } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    refusePopoverChunk: (refuse: boolean) => Promise<void>;
  }
}
const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "popover")!;
afterEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "popover", native);
  await commands.refusePopoverChunk(false);
});

test("native startup is synchronous and leaves browser APIs untouched", () => {
  const show = HTMLElement.prototype.showPopover;
  const order: string[] = [];
  startWithPopover(
    () => order.push("mounted"),
    () => order.push("failed"),
  );
  expect(order).toEqual(["mounted"]);
  expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "popover")).toEqual(native);
  expect(HTMLElement.prototype.showPopover).toBe(show);
});

test("a thrown native mount is not treated as an import failure or mounted again", () => {
  let attempts = 0;
  const failures: unknown[] = [];
  const broken = new Error("mount failed");
  expect(() =>
    startWithPopover(
      () => {
        attempts++;
        throw broken;
      },
      (e) => failures.push(e),
    ),
  ).toThrow(broken);
  expect(attempts).toBe(1);
  expect(failures).toEqual([]);
});

test("missing support waits for the import; a failed chunk reports then mounts once", async () => {
  await commands.refusePopoverChunk(true);
  Reflect.deleteProperty(HTMLElement.prototype, "popover");
  const order: unknown[] = [];
  startWithPopover(
    () => order.push("mounted"),
    (error) => order.push(error),
  );
  expect(order).toEqual([]);
  await vi.waitFor(() => expect(order).toEqual([expect.any(TypeError), "mounted"]));
});
