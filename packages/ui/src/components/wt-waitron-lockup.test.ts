import { afterEach, describe, expect, it } from "vitest";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup, host, lockupWordBaseline, mount, textBaseline } from "../test-helpers.js";
import type { WtWaitronLockup } from "./wt-waitron-lockup.js";
import "./wt-waitron-lockup.js";
import lockupSource from "../../brand/waitron-lockup.svg?raw";
import * as ui from "../index.js";

afterEach(cleanup);

const svg = (el: WtWaitronLockup) => el.shadowRoot!.querySelector<SVGSVGElement>("svg")!;
const piece = (el: WtWaitronLockup, name: "ink" | "sky" | "teal") =>
  getComputedStyle(svg(el).querySelector(`:scope > .${name}`)!);

/** Each element's name and attributes, depth first: the drawing, whatever the serialisation. */
const shape = (node: Element): string[] =>
  [node, ...node.querySelectorAll("*")].map(
    (e) =>
      `${e.localName} ${[...e.attributes]
        .filter((a) => a.name !== "xmlns")
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join(" ")}`,
  );

async function lockup(markup = "<wt-waitron-lockup></wt-waitron-lockup>") {
  await mount(markup);
  const el = host.querySelector<WtWaitronLockup>("wt-waitron-lockup")!;
  await el.updateComplete;
  return el;
}

describe("wt-waitron-lockup", () => {
  it("is exported and registered", () => {
    expect(customElements.get("wt-waitron-lockup")).toBeTypeOf("function");
    expect(ui.WtWaitronLockup).toBe(customElements.get("wt-waitron-lockup"));
  });

  it("draws the brand lockup's own drawing", async () => {
    const el = await lockup();
    const source = new DOMParser().parseFromString(lockupSource, "image/svg+xml").documentElement;
    expect(svg(el).getAttribute("viewBox")).toBe(source.getAttribute("viewBox"));
    expect([...svg(el).children].map(shape)).toEqual([...source.children].map(shape));
  });

  it("paints only the near-black pieces from --wt-color-text and keeps the W's blues fixed", async () => {
    await mount(
      `<div style="--wt-color-primary: #c62828; --wt-color-text: #123456">` +
        `<wt-waitron-lockup></wt-waitron-lockup></div>`,
    );
    const el = host.querySelector<WtWaitronLockup>("wt-waitron-lockup")!;
    await el.updateComplete;
    expect(piece(el, "ink").fill).toBe("rgb(18, 52, 86)");
    expect(piece(el, "sky").fill).toBe("rgb(113, 207, 235)");
    expect(piece(el, "teal").fill).toBe("rgb(0, 115, 146)");
  });

  it.each(["light", "dark"] as const)(
    "paints its ink from the %s theme's text colour and keeps the blues",
    async (theme) => {
      const el = (await mountThemed(
        "<wt-waitron-lockup></wt-waitron-lockup>",
        theme,
      )) as WtWaitronLockup;
      await el.updateComplete;
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(el).getPropertyValue("--wt-color-text");
      el.parentElement!.append(probe);
      const text = getComputedStyle(probe).color;
      probe.remove();
      expect(piece(el, "ink").fill).toBe(text);
      expect(piece(el, "sky").fill).toBe("rgb(113, 207, 235)");
      expect(piece(el, "teal").fill).toBe("rgb(0, 115, 146)");
    },
  );

  it("sizes its height from its width", async () => {
    const el = await lockup('<wt-waitron-lockup style="width: 200px"></wt-waitron-lockup>');
    const [, , w, h] = svg(el).getAttribute("viewBox")!.split(/\s+/).map(Number);
    const box = svg(el).getBoundingClientRect();
    expect(box.width).toBe(200);
    expect(box.height).toBeCloseTo((200 * h!) / w!, 1);
  });

  it("sizes its width from its height", async () => {
    const el = await lockup('<wt-waitron-lockup style="height: 40px"></wt-waitron-lockup>');
    const [, , w, h] = svg(el).getAttribute("viewBox")!.split(/\s+/).map(Number);
    const box = svg(el).getBoundingClientRect();
    expect(box.height).toBe(40);
    expect(box.width).toBeCloseTo((40 * w!) / h!, 1);
  });

  it.each([
    ["its width", "width: 256px"],
    ["its height", "height: 44px"],
  ])(
    "lines up text set beside it by baseline with the word's baseline, sized by %s",
    async (_, size) => {
      await mount(
        `<div style="display: flex; align-items: baseline; font-size: 14px">` +
          `<wt-waitron-lockup style="${size}"></wt-waitron-lockup><span style="white-space: nowrap">Casa Delgado</span></div>`,
      );
      const el = host.querySelector<WtWaitronLockup>("wt-waitron-lockup")!;
      await el.updateComplete;
      expect(textBaseline(host.querySelector("span")!)).toBeCloseTo(lockupWordBaseline(el), 0);
      expect(el.getBoundingClientRect().height).toBeCloseTo(
        svg(el).getBoundingClientRect().height,
        1,
      );
    },
  );

  it("is an image named Waitron by default", async () => {
    const el = await lockup();
    expect(svg(el).getAttribute("role")).toBe("img");
    expect(svg(el).getAttribute("aria-label")).toBe("Waitron");
    expect(svg(el).hasAttribute("aria-hidden")).toBe(false);
  });

  it("takes its name from label", async () => {
    const el = await lockup('<wt-waitron-lockup label="Home"></wt-waitron-lockup>');
    expect(svg(el).getAttribute("aria-label")).toBe("Home");
  });

  it("is decoration with an empty label", async () => {
    const el = await lockup('<wt-waitron-lockup label=""></wt-waitron-lockup>');
    expect(svg(el).getAttribute("aria-hidden")).toBe("true");
    expect(svg(el).hasAttribute("role")).toBe(false);
    expect(svg(el).hasAttribute("aria-label")).toBe(false);
  });
});
