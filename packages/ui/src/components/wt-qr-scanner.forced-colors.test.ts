import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, emulateForcedColours, mount } from "../test-helpers.js";
import { cameraFilming } from "../../test/qr-camera.js";
import "./wt-qr-scanner.js";

let filming: ReturnType<typeof cameraFilming> | undefined;

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
  await emulateForcedColours(null);
});

test("the framed box keeps an edge, and its caption a backing, when forced colours replace its fill", async () => {
  filming = cameraFilming("hello");
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(filming.stream);
  const el = await mount(
    '<wt-qr-scanner framed label="Camera" caption="Point at a sticker"></wt-qr-scanner>',
  );
  await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();
  const box = getComputedStyle(el.shadowRoot!.querySelector("[data-scanner-camera]")!);
  expect(box.borderTopStyle).toBe("solid");
  expect(box.borderTopColor).not.toBe(box.backgroundColor);
  const caption = getComputedStyle(el.shadowRoot!.querySelector("[data-scanner-caption]")!);
  expect(caption.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(caption.color).not.toBe(caption.backgroundColor);
});
