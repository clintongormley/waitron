import { afterEach, describe, expect, it, vi } from "vitest";
import { markOverflow, oncePerFrame } from "./edge-fade.js";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A 100 px strip holding `content` px of content, scrolled `scrolled` px from its start. */
function strip(content: number, scrolled: number, dir: "ltr" | "rtl" = "ltr"): HTMLElement {
  const el = document.createElement("div");
  el.dir = dir;
  el.style.cssText = "width: 100px; overflow-x: auto; display: flex";
  const inner = document.createElement("div");
  inner.style.cssText = `flex: none; width: ${content}px; height: 10px`;
  el.append(inner);
  document.body.append(el);
  el.scrollLeft = dir === "rtl" ? -scrolled : scrolled;
  return el;
}

afterEach(() => document.body.replaceChildren());

describe("markOverflow", () => {
  for (const dir of ["ltr", "rtl"] as const) {
    it(`marks the ends that hide content, ${dir}`, () => {
      const cases: [number, number, string | undefined][] = [
        [100, 0, undefined],
        [300, 0, "end"],
        [300, 100, "both"],
        [300, 200, "start"],
        [300, 199, "start"],
        [300, 198, "both"],
        [300, 1, "end"],
        [300, 2, "both"],
      ];
      for (const [content, scrolled, mark] of cases) {
        const el = strip(content, scrolled, dir);
        markOverflow(el);
        expect([content, scrolled, el.dataset.overflow]).toEqual([content, scrolled, mark]);
      }
    });
  }

  it("clears a mark once nothing is hidden", () => {
    const el = strip(100, 0);
    el.dataset.overflow = "end";
    markOverflow(el);
    expect(el.dataset.overflow).toBeUndefined();
  });
});

describe("oncePerFrame", () => {
  it("runs once in the next frame however often it is scheduled", async () => {
    const run = vi.fn();
    const throttled = oncePerFrame(run);
    throttled.schedule();
    throttled.schedule();
    expect(run).not.toHaveBeenCalled();
    await frame();
    expect(run).toHaveBeenCalledTimes(1);
    throttled.schedule();
    await frame();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs nothing once cancelled, and schedules again afterwards", async () => {
    const run = vi.fn();
    const throttled = oncePerFrame(run);
    throttled.schedule();
    throttled.cancel();
    await frame();
    expect(run).not.toHaveBeenCalled();
    throttled.cancel();
    throttled.schedule();
    await frame();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
