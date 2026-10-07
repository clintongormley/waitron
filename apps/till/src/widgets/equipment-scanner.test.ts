import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import qrcode from "qrcode-generator";
import { formatEquipmentCode } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./equipment-scanner.js";
import type { TillEquipmentScanner } from "./equipment-scanner.js";

const PRINTER = "6f1c3a52-0000-4000-8000-000000000001";
const READER = "6f1c3a52-0000-4000-8000-000000000002";

/** A camera that films `text` as a QR code, drawn onto a canvas again every 50 ms so the stream
 * keeps sending frames. In Chromium only: this is not evidence about a real camera. */
function cameraFilming(text: string): { stream: MediaStream; stop: () => void } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const cell = 6;
  const margin = 4;
  const size = (qr.getModuleCount() + margin * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const draw = () => {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#000";
    for (let row = 0; row < qr.getModuleCount(); row++) {
      for (let col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col))
          context.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
      }
    }
  };
  draw();
  const redraw = setInterval(draw, 50);
  const stream = canvas.captureStream(20);
  return { stream, stop: () => clearInterval(redraw) };
}

let filming: { stop: () => void } | undefined;

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
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

async function mountScanner(kind: "printer" | "reader") {
  const scanned: string[] = [];
  const { el } = await mountWidget<TillEquipmentScanner>("till-equipment-scanner", { kind });
  el.addEventListener("equipment-scanned", (event) =>
    scanned.push((event as CustomEvent<{ id: string }>).detail.id),
  );
  return { el, scanned };
}

const message = (el: TillEquipmentScanner) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-scanner-message]")?.textContent?.trim() ?? "";

describe("till-equipment-scanner", () => {
  it("asks for the rear camera", async () => {
    film(formatEquipmentCode("printer", PRINTER));
    await mountScanner("printer");

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
    });
  });

  it("a Waitron printer label emits its id and stops the camera", async () => {
    const stream = film(formatEquipmentCode("printer", PRINTER));
    const { scanned } = await mountScanner("printer");

    await expect.poll(() => scanned, { timeout: 10_000 }).toEqual([PRINTER]);
    expect(stream.getTracks().every((track) => track.readyState === "ended")).toBe(true);
  });

  it("a reader label on the reader row emits its id", async () => {
    film(formatEquipmentCode("reader", READER));
    const { scanned } = await mountScanner("reader");

    await expect.poll(() => scanned, { timeout: 10_000 }).toEqual([READER]);
  });

  it("a foreign QR emits nothing, says so, and keeps the camera on", async () => {
    const stream = film("https://example.com");
    const { el, scanned } = await mountScanner("printer");

    await expect.poll(() => message(el), { timeout: 10_000 }).toBe(t("equipment.scan_not_ours"));
    expect(scanned).toEqual([]);
    expect(stream.getTracks().every((track) => track.readyState === "live")).toBe(true);
  });

  it("a reader label on a printer row emits nothing and says what it is for", async () => {
    film(formatEquipmentCode("reader", READER));
    const { el, scanned } = await mountScanner("printer");

    await expect.poll(() => message(el), { timeout: 10_000 }).toBe(t("equipment.scan_not_printer"));
    expect(scanned).toEqual([]);
  });

  it("a printer label on the reader row emits nothing and says what it is for", async () => {
    film(formatEquipmentCode("printer", PRINTER));
    const { el, scanned } = await mountScanner("reader");

    await expect.poll(() => message(el), { timeout: 10_000 }).toBe(t("equipment.scan_not_reader"));
    expect(scanned).toEqual([]);
  });

  it("reads past frames with no label in them, saying only how to scan", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d")!;
    const draw = () => {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 320, 240);
    };
    draw();
    const redraw = setInterval(draw, 50);
    filming = { stop: () => clearInterval(redraw) };
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(canvas.captureStream(20));
    const { el, scanned } = await mountScanner("printer");
    const video = el.shadowRoot!.querySelector("video")!;
    await expect.poll(() => video.videoWidth, { timeout: 10_000 }).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(message(el)).toBe(t("equipment.scan_hint"));
    expect(scanned).toEqual([]);
  });

  it("a refused camera shows the message and emits nothing", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const { el, scanned } = await mountScanner("printer");

    await expect.poll(() => message(el)).toBe(t("equipment.camera_unavailable"));
    expect(el.shadowRoot!.querySelector("video")).toBeNull();
    expect(scanned).toEqual([]);
  });

  it("a browser with no camera access shows the same message", async () => {
    // An own property hides the prototype's getter until it is deleted again.
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    try {
      const { el } = await mountScanner("printer");
      await expect.poll(() => message(el)).toBe(t("equipment.camera_unavailable"));
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
    expect(navigator.mediaDevices).toBeDefined();
  });

  it("stops the camera when it is taken off the page", async () => {
    const stream = film("https://example.com");
    const { el } = await mountScanner("printer");
    await expect.poll(() => message(el), { timeout: 10_000 }).toBe(t("equipment.scan_not_ours"));

    el.remove();

    expect(stream.getTracks().every((track) => track.readyState === "ended")).toBe(true);
  });

  it("stops a camera that answers only after it was taken off the page", async () => {
    let answer!: (stream: MediaStream) => void;
    const camera = cameraFilming("https://example.com");
    filming = camera;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    const { el } = await mountScanner("printer");

    el.remove();
    answer(camera.stream);

    await expect
      .poll(() => camera.stream.getTracks().every((track) => track.readyState === "ended"))
      .toBe(true);
  });
});
