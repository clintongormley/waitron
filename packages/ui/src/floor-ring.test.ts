import { LitElement, css, html } from "lit";
import { afterEach, expect, it, test } from "vitest";
import { commands } from "vitest/browser";
import {
  type FloorPulse,
  type FloorRing,
  floorRingStyles,
  renderFloorPulse,
  renderFloorRing,
} from "./floor-ring.js";
import { cleanup, mount } from "./test-helpers.js";
import "./components/wt-icon.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateReducedMotion: (reducedMotion: "reduce" | "no-preference" | null) => Promise<void>;
  }
}

class FloorRingProbe extends LitElement {
  static override properties = {
    ring: { attribute: false },
    moving: { attribute: false },
    pulse: { attribute: false },
    onFill: { attribute: false },
  };
  static override styles = [
    floorRingStyles,
    css`
      .box {
        position: relative;
        display: block;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        border-radius: var(--wt-radius-md);
      }
    `,
  ];
  declare ring: FloorRing | null;
  declare moving: boolean;
  declare pulse: FloorPulse | null;
  declare onFill: boolean | undefined;

  constructor() {
    super();
    this.ring = null;
    this.moving = true;
    this.pulse = null;
    this.onFill = undefined;
  }

  override render() {
    const ring =
      this.onFill === undefined
        ? renderFloorRing(this.ring, this.moving)
        : renderFloorRing(this.ring, this.moving, { onFill: this.onFill });
    return html`<div class="box">${ring}${renderFloorPulse(this.pulse, this.moving)}</div>`;
  }
}
customElements.define("floor-ring-probe", FloorRingProbe);

afterEach(cleanup);

const RINGS: readonly FloorRing[] = ["forgotten", "overdue", "fire", "waiting"];

async function probe(
  ring: FloorRing | null,
  moving = true,
  tokens: Record<string, string> = {},
): Promise<FloorRingProbe> {
  const el = (await mount("<floor-ring-probe></floor-ring-probe>")) as FloorRingProbe;
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
  el.ring = ring;
  el.moving = moving;
  await el.updateComplete;
  return el;
}

async function pulseProbe(
  pulse: FloorPulse | null,
  moving: boolean,
  tokens: Record<string, string> = {},
): Promise<FloorRingProbe> {
  const el = (await mount("<floor-ring-probe></floor-ring-probe>")) as FloorRingProbe;
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
  el.pulse = pulse;
  el.moving = moving;
  await el.updateComplete;
  return el;
}

async function fillProbe(
  ring: FloorRing,
  onFill: boolean,
  tokens: Record<string, string>,
): Promise<FloorRingProbe> {
  const el = (await mount("<floor-ring-probe></floor-ring-probe>")) as FloorRingProbe;
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
  el.ring = ring;
  el.moving = false;
  el.onFill = onFill;
  await el.updateComplete;
  return el;
}

function pulseOf(el: FloorRingProbe): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>("[data-pulse]")!;
}

function ringOf(el: FloorRingProbe): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>("[data-ring]")!;
}

function pulseClasses(ring: HTMLElement): string[] {
  return [...ring.classList].filter((name) => name.startsWith("wt-pulse"));
}

test("draws no ring for no state", async () => {
  const el = await probe(null);
  expect(el.shadowRoot!.querySelector("[data-ring]")).toBeNull();
});

it.each([
  ["forgotten", ["wt-pulse-fast"]],
  ["overdue", ["wt-pulse-slow"]],
  ["fire", ["wt-pulse-slow"]],
  ["waiting", []],
] as const)(
  "draws the %s ring, hidden from assistive technology, pulsing %j",
  async (name, pulses) => {
    const ring = ringOf(await probe(name));
    expect(ring.dataset.ring).toBe(name);
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect(ring.classList.contains("ring")).toBe(true);
    expect(ring.classList.contains(`ring-${name}`)).toBe(true);
    expect(pulseClasses(ring)).toEqual(pulses);
  },
);

test("moves nothing when motion is off", async () => {
  for (const name of RINGS) {
    const ring = ringOf(await probe(name, false));
    expect(pulseClasses(ring), name).toEqual([]);
    expect(getComputedStyle(ring).animationName, name).toBe("none");
  }
});

test("paints the ring from the danger and warning tokens", async () => {
  const tokens = {
    "--wt-color-danger": "rgb(1, 2, 3)",
    "--wt-color-warning": "rgb(4, 5, 6)",
    "--wt-space-1": "7px",
  };
  for (const [name, colour] of [
    ["forgotten", "rgb(1, 2, 3)"],
    ["overdue", "rgb(1, 2, 3)"],
    ["fire", "rgb(4, 5, 6)"],
    ["waiting", "rgb(4, 5, 6)"],
  ] as const) {
    const shadow = getComputedStyle(ringOf(await probe(name, false, tokens))).boxShadow;
    expect(shadow, name).toContain(colour);
    expect(shadow, name).toContain(name === "waiting" ? "3.5px" : "7px");
    expect(shadow, name).toContain("inset");
  }
});

test("draws Waiting's outline half as thick as the others", async () => {
  const tokens = { "--wt-space-1": "8px" };
  for (const name of RINGS) {
    const shadow = getComputedStyle(ringOf(await probe(name, false, tokens))).boxShadow;
    expect(shadow, name).toContain(name === "waiting" ? "4px" : "8px");
    expect(shadow, name).not.toContain(name === "waiting" ? "8px" : "4px");
  }
});

test("dims each colour to its own theme token, at full opacity", async () => {
  const tokens = {
    "--wt-color-danger-pulse-dim": "rgb(9, 8, 7)",
    "--wt-color-warning-pulse-dim": "rgb(6, 5, 4)",
    "--wt-duration-pulse-slow": "2000ms",
    "--wt-duration-pulse-fast": "2000ms",
  };
  for (const [name, dim] of [
    ["forgotten", "rgb(9, 8, 7)"],
    ["overdue", "rgb(9, 8, 7)"],
    ["fire", "rgb(6, 5, 4)"],
  ] as const) {
    const ring = ringOf(await probe(name, true, tokens));
    const [animation] = ring.getAnimations();
    animation!.pause();
    animation!.currentTime = 1000;
    const style = getComputedStyle(ring);
    expect(style.color, name).toBe(dim);
    expect(style.boxShadow, name).toContain(dim);
    expect(style.opacity, name).toBe("1");
  }
});

test("lies over its box, under nothing it could catch", async () => {
  const el = await probe("overdue", false, { "--wt-radius-md": "9px" });
  const ring = getComputedStyle(ringOf(el));
  const box = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>(".box")!);
  expect(ring.position).toBe("absolute");
  expect(ring.top).toBe("0px");
  expect(ring.left).toBe("0px");
  expect(ring.right).toBe("0px");
  expect(ring.bottom).toBe("0px");
  expect(ring.pointerEvents).toBe("none");
  expect(box.borderRadius).toBe("9px");
  expect(ring.borderRadius).toBe(box.borderRadius);
});

test("pulses at each speed's token", async () => {
  const tokens = {
    "--wt-duration-pulse-slow": "5000ms",
    "--wt-duration-pulse-fast": "3000ms",
  };
  for (const [name, duration] of [
    ["overdue", "5s"],
    ["forgotten", "3s"],
  ] as const) {
    const style = getComputedStyle(ringOf(await probe(name, true, tokens)));
    expect(style.animationName, name).toBe("wt-pulse");
    expect(style.animationDuration, name).toBe(duration);
    expect(style.animationTimingFunction, name).toBe("ease-in-out");
    expect(style.animationIterationCount, name).toBe("infinite");
  }
});

test("dims to the dim token half-way and is whole at the ends", async () => {
  const ring = ringOf(
    await probe("overdue", true, {
      "--wt-color-danger": "rgb(1, 2, 3)",
      "--wt-color-danger-pulse-dim": "rgb(9, 8, 7)",
      "--wt-duration-pulse-slow": "2000ms",
    }),
  );
  const [animation] = ring.getAnimations();
  animation!.pause();
  animation!.currentTime = 1000;
  expect(getComputedStyle(ring).color).toBe("rgb(9, 8, 7)");
  expect(getComputedStyle(ring).opacity).toBe("1");
  animation!.currentTime = 0;
  expect(getComputedStyle(ring).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(ring).opacity).toBe("1");
});

test("stands still when the system asks for reduced motion", async () => {
  await commands.emulateReducedMotion("reduce");
  try {
    for (const name of ["forgotten", "overdue"] as const) {
      const ring = ringOf(await probe(name));
      expect(pulseClasses(ring), name).not.toEqual([]);
      expect(getComputedStyle(ring).animationName, name).toBe("none");
    }
  } finally {
    await commands.emulateReducedMotion(null);
  }
});

test("registers the check icon", async () => {
  await import("./floor-chips.js");
  const icon = await mount('<wt-icon name="floor-check"></wt-icon>');
  const path = icon.shadowRoot!.querySelector("svg path");
  expect(path).not.toBeNull();
  expect(path!.getAttribute("d")).not.toBe("");
});

test("draws no pulse for none, or while still", async () => {
  expect((await pulseProbe(null, true)).shadowRoot!.querySelector("[data-pulse]")).toBeNull();
  expect(
    (await pulseProbe("forgotten", false)).shadowRoot!.querySelector("[data-pulse]"),
  ).toBeNull();
});

it.each([
  ["forgotten", "wt-pulse-fast"],
  ["overdue", "wt-pulse-slow"],
  ["fire", "wt-pulse-slow"],
] as const)("draws the %s pulse, hidden from assistive technology, at %s", async (name, speed) => {
  const pulse = pulseOf(await pulseProbe(name, true));
  expect(pulse.dataset.pulse).toBe(name);
  expect(pulse.getAttribute("aria-hidden")).toBe("true");
  expect(pulse.classList.contains("pulse")).toBe(true);
  expect(pulse.classList.contains(`ring-${name}`)).toBe(true);
  expect(pulseClasses(pulse)).toEqual([speed]);
});

test("rings outside its box, after a gap in the surface colour", async () => {
  const el = await pulseProbe("forgotten", true, {
    "--wt-space-1": "8px",
    "--wt-color-surface": "rgb(9, 9, 9)",
    "--wt-color-danger": "rgb(1, 2, 3)",
    "--wt-radius-md": "9px",
  });
  const pulse = pulseOf(el);
  const [animation] = pulse.getAnimations();
  animation!.pause();
  animation!.currentTime = 0;
  const style = getComputedStyle(pulse);
  expect(style.boxShadow).toBe("rgb(9, 9, 9) 0px 0px 0px 4px, rgb(1, 2, 3) 0px 0px 0px 12px");
  expect(style.boxShadow).not.toContain("inset");
  expect(style.position).toBe("absolute");
  expect(style.top).toBe("0px");
  expect(style.left).toBe("0px");
  expect(style.right).toBe("0px");
  expect(style.bottom).toBe("0px");
  expect(style.pointerEvents).toBe("none");
  const box = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>(".box")!);
  expect(box.borderRadius).toBe("9px");
  expect(style.borderRadius).toBe(box.borderRadius);
});

test("a pulse dims to its colour's dim token half-way", async () => {
  const pulse = pulseOf(
    await pulseProbe("fire", true, {
      "--wt-color-warning": "rgb(4, 5, 6)",
      "--wt-color-warning-pulse-dim": "rgb(6, 5, 4)",
      "--wt-duration-pulse-slow": "2000ms",
    }),
  );
  const [animation] = pulse.getAnimations();
  animation!.pause();
  animation!.currentTime = 1000;
  expect(getComputedStyle(pulse).color).toBe("rgb(6, 5, 4)");
  expect(getComputedStyle(pulse).opacity).toBe("1");
});

test("an outline on a fill has a surface line inside it", async () => {
  const tokens = { "--wt-space-1": "8px", "--wt-color-surface": "rgb(9, 9, 9)" };
  const overdue = getComputedStyle(ringOf(await fillProbe("overdue", true, tokens))).boxShadow;
  expect(overdue.match(/inset/g)).toHaveLength(2);
  expect(overdue.split(/, (?=rgb)/)[1]).toBe("rgb(9, 9, 9) 0px 0px 0px 9px inset");
  expect(overdue).toContain(" 0px 0px 0px 8px inset");

  const waiting = getComputedStyle(ringOf(await fillProbe("waiting", true, tokens))).boxShadow;
  expect(waiting.match(/inset/g)).toHaveLength(2);
  expect(waiting).toContain(" 0px 0px 0px 4px inset");
  expect(waiting.split(/, (?=rgb)/)[1]).toBe("rgb(9, 9, 9) 0px 0px 0px 5px inset");

  for (const name of ["overdue", "waiting"] as const) {
    const ring = ringOf(await fillProbe(name, false, tokens));
    expect(ring.classList.contains("on-fill"), name).toBe(false);
    const plain = getComputedStyle(ring).boxShadow;
    expect(plain.match(/inset/g), name).toHaveLength(1);
    expect(plain, name).not.toContain("rgb(9, 9, 9)");
  }
});
