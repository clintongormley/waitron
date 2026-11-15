import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { WtSwitch } from "./wt-switch.js";
import "./wt-switch.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

/** The pixel the contrast theme paints for a system colour, read from a swatch the theme leaves alone. */
async function systemColour(name: "Highlight" | "GrayText"): Promise<number[]> {
  const swatch = await mount(
    `<div style="width: 20px; height: 20px; forced-color-adjust: none; background: ${name}"></div>`,
  );
  const box = swatch.getBoundingClientRect();
  return (await elementPixels(swatch))(box.left + 10, box.top + 10);
}

/** Samples a switch under forced colours: the page background beside it, the middle of the
 * thumb's OFF place, and the middle of the track's far end, which only the ON thumb covers. */
async function sample(checked: boolean) {
  const el = (await mount(`<wt-switch accessible-name="Training mode"></wt-switch>`)) as WtSwitch;
  el.checked = checked;
  await el.updateComplete;
  await Promise.all(el.shadowRoot!.getAnimations().map((animation) => animation.finished));
  const track = el.shadowRoot!.querySelector(".track")!.getBoundingClientRect();
  const control = el.shadowRoot!.querySelector(".control")!.getBoundingClientRect();
  const at = await elementPixels(el);
  const middle = track.top + track.height / 2;
  return {
    background: at(control.right - 2, control.top + 2),
    start: at(track.left + 4, middle),
    end: at(track.right - 4, middle),
    centre: at(track.left + track.width / 2, middle),
  };
}

test("an OFF switch draws its track and thumb, and ON reads differently", async () => {
  const off = await sample(false);
  // The thumb sits at the start, drawn; the uncovered end of the track is the page colour.
  expect(off.start).not.toEqual(off.background);
  expect(off.end).toEqual(off.background);

  const on = await sample(true);
  // ON fills the track, so its start is drawn, and the thumb now at the end stands out from it.
  expect(on.start).not.toEqual(on.background);
  expect(distance(on.end, on.start)).toBeGreaterThan(150);
  expect(on.start).not.toEqual(off.start);
});

test("a disabled switch is drawn in the theme's disabled colour at full strength", async () => {
  const grayText = await systemColour("GrayText");
  const el = (await mount(
    `<wt-switch accessible-name="Training mode" disabled></wt-switch>`,
  )) as WtSwitch;
  const thumb = el.shadowRoot!.querySelector(".thumb")!.getBoundingClientRect();
  const at = await elementPixels(el);
  expect(at(thumb.left + thumb.width / 2, thumb.top + thumb.height / 2)).toEqual(grayText);
});

/** The darkest pixel of a switch's label text: on the light contrast theme Chromium emulates, that is
 * where the text's own colour shows. */
async function darkestLabelPixel(el: WtSwitch): Promise<number[]> {
  const label = el.shadowRoot!.querySelector("label")!;
  const box = label.getBoundingClientRect();
  const at = await elementPixels(el);
  let darkest = [255, 255, 255];
  for (let y = box.top + 0.5; y < box.bottom; y += 1) {
    for (let x = box.left + 0.5; x < box.right; x += 1) {
      const pixel = at(x, y);
      if (pixel.reduce((a, b) => a + b) < darkest.reduce((a, b) => a + b)) darkest = pixel;
    }
  }
  return darkest;
}

test("a disabled switch's label is drawn in the theme's disabled colour", async () => {
  const grayText = await systemColour("GrayText");
  const enabled = (await mount(`<wt-switch label="Training mode"></wt-switch>`)) as WtSwitch;
  expect(distance(await darkestLabelPixel(enabled), grayText)).toBeGreaterThan(40);
  const disabled = (await mount(
    `<wt-switch label="Training mode" disabled></wt-switch>`,
  )) as WtSwitch;
  expect(distance(await darkestLabelPixel(disabled), grayText)).toBeLessThan(40);
});

test("a keyboard-focused switch is ringed in the theme's highlight colour", async () => {
  const highlight = await systemColour("Highlight");
  const before = await mount(
    `<button style="display: block">Before</button><wt-switch accessible-name="Training mode"></wt-switch>`,
  );
  const el = before.nextElementSibling as WtSwitch;
  before.focus();
  await userEvent.tab();
  expect(el.shadowRoot!.querySelector("input")!.matches(":focus-visible")).toBe(true);
  const track = el.shadowRoot!.querySelector(".track")!.getBoundingClientRect();
  const at = await elementPixels(el);
  // The ring sits a focus offset above the track, centred on its width.
  expect(at(track.left + track.width / 2, track.top - 3)).toEqual(highlight);
});

test("outside forced colours the track is still its fill alone", async () => {
  await emulateForcedColours("none");
  const el = await mount(`<wt-switch accessible-name="Training mode"></wt-switch>`);
  const track = el.shadowRoot!.querySelector(".track")!;
  expect(getComputedStyle(track).borderTopStyle).toBe("none");
  expect(getComputedStyle(track).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
});
