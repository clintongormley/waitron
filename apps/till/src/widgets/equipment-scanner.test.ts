import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatEquipmentCode } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import "./equipment-scanner.js";
import { cameraFilming, cameraShowing } from "@waitron/ui/test/qr-camera.js";
import type { TillEquipmentScanner } from "./equipment-scanner.js";

const PRINTER = "6f1c3a52-0000-4000-8000-000000000001";
const READER = "6f1c3a52-0000-4000-8000-000000000002";

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

async function mountScanner(kind: "printer" | "reader" | "any", more: object = {}) {
  const scanned: string[] = [];
  const { el } = await mountWidget<TillEquipmentScanner>("till-equipment-scanner", {
    kind,
    ...more,
  });
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

  it("on either kind, a printer label emits its id and kind", async () => {
    film(formatEquipmentCode("printer", PRINTER));
    const { el } = await mountScanner("any");
    const details: unknown[] = [];
    el.addEventListener("equipment-scanned", (event) =>
      details.push((event as CustomEvent).detail),
    );

    await expect
      .poll(() => details, { timeout: 10_000 })
      .toEqual([{ id: PRINTER, kind: "printer" }]);
  });

  it("on either kind, a reader label emits its id and kind", async () => {
    film(formatEquipmentCode("reader", READER));
    const { el } = await mountScanner("any");
    const details: unknown[] = [];
    el.addEventListener("equipment-scanned", (event) =>
      details.push((event as CustomEvent).detail),
    );

    await expect.poll(() => details, { timeout: 10_000 }).toEqual([{ id: READER, kind: "reader" }]);
  });

  it("on either kind, a foreign QR still says it is not ours", async () => {
    film("https://example.com");
    const { el, scanned } = await mountScanner("any");

    await expect.poll(() => message(el), { timeout: 10_000 }).toBe(t("equipment.scan_not_ours"));
    expect(scanned).toEqual([]);
  });

  it.each([
    ["en", "That is not a Waitron equipment label"],
    ["es", es["equipment.scan_not_ours"]],
  ] as const)("a foreign QR is called a label, not a sticker (%s)", async (locale, words) => {
    setLocale(locale);
    film("https://example.com");
    const { el } = await mountScanner("any");

    await expect.poll(() => message(el), { timeout: 10_000 }).toBe(words);
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

  it("names the video with the till's camera label, in English and in Spanish", async () => {
    film(formatEquipmentCode("printer", PRINTER));
    const { el } = await mountScanner("printer");
    await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();
    const name = () => el.shadowRoot!.querySelector("video")!.getAttribute("aria-label");
    expect(name()).toBe("Camera");

    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;

    expect(name()).toBe(es["equipment.camera_label"]);
    expect(name()).not.toBe("Camera");
  });
});

describe("till-equipment-scanner keep-going", () => {
  function showing(first: string) {
    const camera = cameraShowing(first);
    filming = camera;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
    return camera;
  }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = { timeout: 10_000 };

  it("sends each sticker once while it stays in view, and again after 2 s out of view", async () => {
    const camera = showing(formatEquipmentCode("reader", READER));
    const { scanned } = await mountScanner("any", { keepGoing: true });
    await expect.poll(() => scanned, poll).toEqual([READER]);
    camera.show(formatEquipmentCode("printer", PRINTER));
    await expect.poll(() => scanned, poll).toEqual([READER, PRINTER]);
    await wait(2_600);
    expect(scanned).toEqual([READER, PRINTER]);

    camera.show(null);
    await wait(2_300);
    camera.show(formatEquipmentCode("printer", PRINTER));
    await expect.poll(() => scanned, poll).toEqual([READER, PRINTER, PRINTER]);
    expect(camera.stream.getTracks().every((track) => track.readyState === "live")).toBe(true);
  });

  it("clears an earlier not-ours message once a sticker is accepted, and draws its caption", async () => {
    const camera = showing("https://example.com");
    const { el, scanned } = await mountScanner("any", {
      keepGoing: true,
      framed: true,
      caption: "Scan as many as you need",
    });
    await expect.poll(() => message(el), poll).toBe(t("equipment.scan_not_ours"));
    camera.show(formatEquipmentCode("printer", PRINTER));
    await expect.poll(() => scanned, poll).toEqual([PRINTER]);
    await el.updateComplete;
    expect(message(el)).toBe("");
    const caption = el.shadowRoot!.querySelector("[data-scanner-caption]")!;
    expect(caption.textContent!.trim()).toBe("Scan as many as you need");
  });
});
