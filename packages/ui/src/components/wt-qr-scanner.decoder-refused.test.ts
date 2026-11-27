import { afterEach, expect, test, vi } from "vitest";
import { commands } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import { cameraFilming } from "../../test/qr-camera.js";
import "./wt-qr-scanner.js";
import type { WtQrScanner } from "./wt-qr-scanner.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    refuseQrDecoderChunk: (refuse: boolean) => Promise<Array<{ url: string; outcome: string }>>;
  }
}

let filming: { stop: () => void } | undefined;

afterEach(async () => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
  await commands.refuseQrDecoderChunk(false);
});

test("a decoder that does not load stops the camera and says the scanner cannot film", async () => {
  await commands.refuseQrDecoderChunk(true);
  const camera = cameraFilming("hello");
  filming = camera;
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
  const unavailable = vi.fn();
  document.addEventListener("wt-qr-unavailable", unavailable, { once: true });
  const el = (await mount(
    '<wt-qr-scanner label="Camera" unavailable="The camera did not start"></wt-qr-scanner>',
  )) as WtQrScanner;

  try {
    await expect.poll(() => unavailable.mock.calls.length, { timeout: 10_000 }).toBe(1);
  } catch (error) {
    const phase = (el as unknown as { phase: string }).phase;
    const video = el.shadowRoot!.querySelector("video") !== null;
    const tracks = camera.stream.getTracks().map((track) => track.readyState);
    const decoderLoads = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("jsqr"))
      .map((entry) => {
        const { name, responseStatus, transferSize } = entry as PerformanceResourceTiming;
        return { name, responseStatus, transferSize };
      });
    const refusals = await commands.refuseQrDecoderChunk(false);
    throw new Error(
      `no wt-qr-unavailable event: phase=${phase} video=${video} tracks=${JSON.stringify(tracks)} ` +
        `decoderLoads=${JSON.stringify(decoderLoads)} refused=${JSON.stringify(refusals)}`,
      { cause: error },
    );
  }
  expect((unavailable.mock.calls[0]![0] as CustomEvent).detail).toEqual({ reason: "unsupported" });
  expect(camera.stream.getTracks().every((track) => track.readyState === "ended")).toBe(true);
  expect(el.shadowRoot!.querySelector("video")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-scanner-message]")!.textContent!.trim()).toBe(
    "The camera did not start",
  );
});
