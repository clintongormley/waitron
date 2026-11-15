import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { WtSwitch } from "./wt-switch.js";
import "./wt-switch.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours("none");
});

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

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

test("a disabled switch is still drawn under forced colours", async () => {
  const el = (await mount(
    `<wt-switch accessible-name="Training mode" disabled></wt-switch>`,
  )) as WtSwitch;
  const track = el.shadowRoot!.querySelector(".track")!.getBoundingClientRect();
  const control = el.shadowRoot!.querySelector(".control")!.getBoundingClientRect();
  const at = await elementPixels(el);
  expect(at(track.left + 4, track.top + track.height / 2)).not.toEqual(
    at(control.right - 2, control.top + 2),
  );
});

test("outside forced colours the track is still its fill alone", async () => {
  await emulateForcedColours("none");
  const el = await mount(`<wt-switch accessible-name="Training mode"></wt-switch>`);
  const track = el.shadowRoot!.querySelector(".track")!;
  expect(getComputedStyle(track).borderTopStyle).toBe("none");
  expect(getComputedStyle(track).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
});
