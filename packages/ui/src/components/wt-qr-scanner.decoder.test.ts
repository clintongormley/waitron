import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import { cameraFilming } from "../../test/qr-camera.js";
import "./wt-qr-scanner.js";
import type { WtQrScanner } from "./wt-qr-scanner.js";

// The decoder is imported only once a camera answers; this gate holds that import open.
const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open, loads: 0, loaded: false };
});
vi.mock("jsqr", async (importOriginal) => {
  gate.loads++;
  await gate.opened;
  const module = await importOriginal();
  gate.loaded = true;
  return module;
});

let filming: { stop: () => void } | undefined;

afterEach(() => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
});

const SCANNER =
  '<wt-qr-scanner label="Camera" unavailable="The camera did not start"></wt-qr-scanner>';
const ended = (stream: MediaStream) => stream.getTracks().every((t) => t.readyState === "ended");

describe("wt-qr-scanner's decoder", () => {
  test("a scanner stopped while the decoder loads reads no frame once it has loaded", async () => {
    const camera = cameraFilming("hello");
    filming = camera;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
    const drawn = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    const el = (await mount(SCANNER)) as WtQrScanner;
    await expect.poll(() => gate.loads).toBe(1);
    await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();

    el.stop();
    expect(ended(camera.stream)).toBe(true);
    const still = cameraFilming("hello");
    try {
      const video = el.shadowRoot!.querySelector("video")!;
      video.srcObject = still.stream;
      await video.play();
      await expect.poll(() => video.videoWidth).toBeGreaterThan(0);
      gate.open();
      await expect.poll(() => gate.loaded).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(drawn).not.toHaveBeenCalled();
    } finally {
      still.stop();
      for (const track of still.stream.getTracks()) track.stop();
    }
  });
});
