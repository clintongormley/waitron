import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { cameraFilming } from "../../test/qr-camera.js";
import "../index.js";
import type { WtQrScanner } from "./wt-qr-scanner.js";

let filming: { stop: () => void } | undefined;

afterEach(() => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
});

function film(text: string): MediaStream {
  const camera = cameraFilming(text);
  filming = camera;
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
  return camera.stream;
}

const SCANNER =
  '<wt-qr-scanner label="Camera" hint="Hold the code up to the camera" unavailable="The camera did not start"></wt-qr-scanner>';

const message = (el: WtQrScanner) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-scanner-message]")?.textContent?.trim() ?? "";
const live = (stream: MediaStream) => stream.getTracks().every((t) => t.readyState === "live");
const ended = (stream: MediaStream) => stream.getTracks().every((t) => t.readyState === "ended");

describe("wt-qr-scanner", () => {
  test("asks for the rear camera and shows the hint while filming", async () => {
    film("hello");
    const el = (await mount(SCANNER)) as WtQrScanner;

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
    });
    expect(message(el)).toBe("Hold the code up to the camera");
    await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();
    const video = el.shadowRoot!.querySelector("video")!;
    expect(video.getAttribute("aria-label")).toBe("Camera");
    expect(el.shadowRoot!.querySelector("[data-scanner-message]")!.getAttribute("role")).toBe(
      "status",
    );
  });

  test("the scanner reads a QR code from a still frame and fires wt-qr-read with its text", async () => {
    film("WAITRON-QR-1");
    const el = await mountInShadowRoot(SCANNER);
    const reads: CustomEvent<{ text: string }>[] = [];
    document.addEventListener("wt-qr-read", (event) => reads.push(event as CustomEvent), {
      once: true,
    });

    await expect.poll(() => reads.length, { timeout: 10_000 }).toBe(1);
    expect(reads[0]!.detail).toEqual({ text: "WAITRON-QR-1" });
    expect(reads[0]!.bubbles).toBe(true);
    expect(reads[0]!.composed).toBe(true);
    expect(el.localName).toBe("wt-qr-scanner");
  });

  test("the camera keeps running after a code the caller does not accept", async () => {
    const stream = film("https://example.com");
    const el = (await mount(SCANNER)) as WtQrScanner;
    const texts: string[] = [];
    el.addEventListener("wt-qr-read", (event) => {
      texts.push((event as CustomEvent<{ text: string }>).detail.text);
      el.message = "That is not the code";
    });

    await expect.poll(() => texts.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    expect(new Set(texts)).toEqual(new Set(["https://example.com"]));
    expect(message(el)).toBe("That is not the code");
    expect(live(stream)).toBe(true);
  });

  test("a cleared message brings the hint back", async () => {
    film("hello");
    const el = (await mount(SCANNER)) as WtQrScanner;
    el.message = "Not that one";
    await el.updateComplete;
    expect(message(el)).toBe("Not that one");
    el.message = "";
    await el.updateComplete;
    expect(message(el)).toBe("Hold the code up to the camera");
  });

  test("stop() ends every track and reads no more codes", async () => {
    const stream = film("hello");
    const el = (await mount(SCANNER)) as WtQrScanner;
    const reads = vi.fn();
    el.addEventListener("wt-qr-read", () => {
      reads();
      el.stop();
    });

    await expect.poll(() => reads.mock.calls.length, { timeout: 10_000 }).toBe(1);
    expect(ended(stream)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("after stop() no frame is read, even from a video still playing", async () => {
    film("hello");
    const drawn = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    const el = (await mount(SCANNER)) as WtQrScanner;
    await expect.poll(() => drawn.mock.calls.length, { timeout: 10_000 }).toBeGreaterThan(0);

    el.stop();
    const still = cameraFilming("hello");
    try {
      const video = el.shadowRoot!.querySelector("video")!;
      video.srcObject = still.stream;
      await video.play();
      await expect.poll(() => video.videoWidth).toBeGreaterThan(0);
      drawn.mockClear();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(live(still.stream)).toBe(true);
      expect(drawn).not.toHaveBeenCalled();
    } finally {
      still.stop();
      for (const track of still.stream.getTracks()) track.stop();
    }
  });

  test("the camera stops when the scanner leaves the page", async () => {
    const stream = film("hello");
    const el = (await mount(SCANNER)) as WtQrScanner;
    await expect.poll(() => live(stream)).toBe(true);

    el.remove();

    expect(ended(stream)).toBe(true);
  });

  test("a camera that answers after the scanner left the page is stopped at once", async () => {
    let answer!: (stream: MediaStream) => void;
    const camera = cameraFilming("hello");
    filming = camera;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    const el = await mount(SCANNER);

    el.remove();
    answer(camera.stream);

    await expect.poll(() => ended(camera.stream)).toBe(true);
  });

  test("a camera refusal that arrives after the scanner left the page says nothing", async () => {
    let refuse!: (error: DOMException) => void;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(
      new Promise((_resolve, reject) => (refuse = reject)),
    );
    const unavailable = vi.fn();
    const el = (await mount(SCANNER)) as WtQrScanner;
    el.addEventListener("wt-qr-unavailable", unavailable);

    el.remove();
    refuse(new DOMException("Permission denied", "NotAllowedError"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unavailable).not.toHaveBeenCalled();
  });

  test("the caller's unavailable text shows when getUserMedia refuses", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const unavailable = vi.fn();
    document.addEventListener("wt-qr-unavailable", unavailable, { once: true });
    const el = (await mountInShadowRoot(SCANNER)) as WtQrScanner;
    el.message = "A message the camera never got to";

    await expect.poll(() => message(el)).toBe("The camera did not start");
    expect(el.shadowRoot!.querySelector("video")).toBeNull();
    expect(unavailable).toHaveBeenCalledTimes(1);
    const event = unavailable.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ reason: "refused" });
    expect(event.composed).toBe(true);
  });

  test("a camera whose picture will not play is released and said to be unavailable", async () => {
    const stream = film("hello");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new DOMException("The picture would not play", "NotAllowedError"),
    );
    const unavailable = vi.fn();
    document.addEventListener("wt-qr-unavailable", unavailable, { once: true });
    const el = (await mountInShadowRoot(SCANNER)) as WtQrScanner;

    await expect.poll(() => message(el)).toBe("The camera did not start");
    expect(ended(stream)).toBe(true);
    expect(el.shadowRoot!.querySelector("video")).toBeNull();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect((unavailable.mock.calls[0]![0] as CustomEvent).detail).toEqual({ reason: "failed" });
  });

  test("a picture that fails to play after stop() says nothing", async () => {
    film("hello");
    let refuse!: (error: DOMException) => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(
      new Promise((_resolve, reject) => (refuse = reject)),
    );
    const unavailable = vi.fn();
    const el = (await mount(SCANNER)) as WtQrScanner;
    el.addEventListener("wt-qr-unavailable", unavailable);
    await expect.poll(() => HTMLMediaElement.prototype.play).toHaveBeenCalled();

    el.stop();
    refuse(new DOMException("Interrupted", "AbortError"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unavailable).not.toHaveBeenCalled();
    expect(message(el)).toBe("Hold the code up to the camera");
  });

  test("a camera that stops by itself while filming is released and said to be unavailable", async () => {
    const stream = film("hello");
    const unavailable = vi.fn();
    const el = (await mount(SCANNER)) as WtQrScanner;
    el.addEventListener("wt-qr-unavailable", unavailable);
    const drawn = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    await expect.poll(() => drawn.mock.calls.length, { timeout: 10_000 }).toBeGreaterThan(0);

    // What the browser fires when the camera is unplugged or another program takes it.
    stream.getVideoTracks()[0]!.dispatchEvent(new Event("ended"));

    await expect.poll(() => message(el)).toBe("The camera did not start");
    expect(ended(stream)).toBe(true);
    expect(el.shadowRoot!.querySelector("video")).toBeNull();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect((unavailable.mock.calls[0]![0] as CustomEvent).detail).toEqual({ reason: "failed" });
    drawn.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(drawn).not.toHaveBeenCalled();
  });

  test("a track that ends after stop() says nothing", async () => {
    const stream = film("hello");
    const unavailable = vi.fn();
    const el = (await mount(SCANNER)) as WtQrScanner;
    el.addEventListener("wt-qr-unavailable", unavailable);
    await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();

    el.stop();
    stream.getVideoTracks()[0]!.dispatchEvent(new Event("ended"));
    await el.updateComplete;

    expect(unavailable).not.toHaveBeenCalled();
    expect(message(el)).toBe("Hold the code up to the camera");
  });

  test("a browser with no camera access shows the unavailable text", async () => {
    // An own property hides the prototype's getter until it is deleted again.
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const unavailable = vi.fn();
    document.addEventListener("wt-qr-unavailable", unavailable, { once: true });
    try {
      const el = (await mountInShadowRoot(SCANNER)) as WtQrScanner;
      await expect.poll(() => message(el)).toBe("The camera did not start");
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
    expect(navigator.mediaDevices).toBeDefined();
    expect((unavailable.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      reason: "unsupported",
    });
  });

  test("the video and message paint from the tokens", async () => {
    film("hello");
    const el = (await mount(SCANNER)) as WtQrScanner;
    await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();
    host.style.setProperty("--wt-color-surface-raised", "rgb(10, 20, 30)");
    host.style.setProperty("--wt-radius-md", "7px");
    host.style.setProperty("--wt-space-2", "13px");
    host.style.setProperty("--wt-color-text", "rgb(40, 50, 60)");
    const video = getComputedStyle(el.shadowRoot!.querySelector("video")!);
    expect(video.backgroundColor).toBe("rgb(10, 20, 30)");
    expect(video.borderTopLeftRadius).toBe("7px");
    expect(getComputedStyle(el).rowGap).toBe("13px");
    expect(getComputedStyle(el.shadowRoot!.querySelector("[data-scanner-message]")!).color).toBe(
      "rgb(40, 50, 60)",
    );
  });
});
