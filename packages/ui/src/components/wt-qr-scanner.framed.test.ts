import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import { cameraFilming } from "../../test/qr-camera.js";
import "../index.js";
import type { WtQrScanner } from "./wt-qr-scanner.js";

let filming: ReturnType<typeof cameraFilming> | undefined;

afterEach(() => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
});

async function framed(attributes: string): Promise<WtQrScanner> {
  filming = cameraFilming("hello");
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(filming.stream);
  const el = (await mount(
    `<wt-qr-scanner framed label="Camera" hint="Hold the code up" ${attributes}></wt-qr-scanner>`,
  )) as WtQrScanner;
  await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();
  return el;
}

const find = (el: WtQrScanner, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-scanner-${name}]`);

test("films in a dark box painted from tokens, under four unnamed corner brackets and the caption", async () => {
  const el = await framed('caption="Point at a sticker"');
  for (const [name, setting] of Object.entries({
    "--wt-camera-height": "111px",
    "--wt-color-camera": "rgb(1, 2, 3)",
    "--wt-color-on-camera": "rgb(4, 5, 6)",
    "--wt-camera-bracket-size": "21px",
    "--wt-camera-bracket-line": "5px",
    "--wt-camera-bracket-inset-block": "9px",
    "--wt-camera-bracket-inset-inline": "13px",
  }))
    host.style.setProperty(name, setting);
  const box = find(el, "camera")!;
  const look = (node: HTMLElement, keys: string) =>
    keys.split(" ").map((key) => getComputedStyle(node).getPropertyValue(key));
  expect(box.contains(el.shadowRoot!.querySelector("video"))).toBe(true);
  expect(look(box, "height background-color margin-left margin-right")).toEqual([
    "111px",
    "rgb(1, 2, 3)",
    "0px",
    "0px",
  ]);
  const brackets = [...box.querySelectorAll<HTMLElement>("[data-scanner-bracket]")];
  expect(brackets.map((b) => b.dataset.scannerBracket)).toEqual([
    "top-start",
    "top-end",
    "bottom-start",
    "bottom-end",
  ]);
  expect(brackets.every((b) => b.getAttribute("aria-hidden") === "true")).toBe(true);
  const sides = "width bottom right border-bottom-width border-top-width border-bottom-color";
  expect(look(brackets[3]!, sides)).toEqual(["21px", "9px", "13px", "5px", "0px", "rgb(4, 5, 6)"]);
  const caption = find(el, "caption")!;
  expect(box.contains(caption)).toBe(true);
  expect([caption.textContent!.trim(), ...look(caption, "color background-color")]).toEqual([
    "Point at a sticker",
    "rgb(4, 5, 6)",
    "rgb(1, 2, 3)",
  ]);
  expect(el.shadowRoot!.textContent).not.toContain("Hold the code up");
});

test("without a caption the hint is the caption, a refusal is drawn under the box, and turning the frame off and on keeps the picture on the camera and reading", async () => {
  const el = await framed("");
  expect(find(el, "caption")!.textContent!.trim()).toBe("Hold the code up");
  expect(find(el, "message")).toBeNull();
  el.message = "That is not the code";
  await el.updateComplete;
  expect(find(el, "camera")!.nextElementSibling).toBe(find(el, "message"));
  for (const on of [false, true]) {
    el.framed = on;
    await el.updateComplete;
    expect(find(el, "camera") !== null).toBe(on);
    const video = el.shadowRoot!.querySelector("video")!;
    expect(video.srcObject).toBe(filming!.stream);
    const reads: string[] = [];
    el.addEventListener("wt-qr-read", (event) => reads.push((event as CustomEvent).detail.text));
    await expect.poll(() => reads[0]).toBe("hello");
    expect(video.isConnected && !video.paused).toBe(true);
  }
});

test("a refused camera draws no box, only the unavailable line", async () => {
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
    new DOMException("Permission denied", "NotAllowedError"),
  );
  const el = (await mount(
    '<wt-qr-scanner framed label="Camera" unavailable="The camera did not start"></wt-qr-scanner>',
  )) as WtQrScanner;
  await expect
    .poll(() => find(el, "message")?.textContent?.trim())
    .toBe("The camera did not start");
  expect(find(el, "camera")).toBeNull();
});
