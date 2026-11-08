import { afterEach, describe, expect, it } from "vitest";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup, host, lockupWordBaseline, mount, textBaseline } from "../test-helpers.js";
import type { WtWaitronLockup } from "./wt-waitron-lockup.js";
import "./wt-waitron-lockup.js";
import lockupSource from "../../brand/waitron-lockup.svg?raw";
import * as ui from "../index.js";

afterEach(cleanup);

const svg = (el: WtWaitronLockup) => el.shadowRoot!.querySelector<SVGSVGElement>("svg")!;
const groups = (el: WtWaitronLockup) =>
  [...svg(el).children].filter((node): node is SVGGElement => node.localName === "g");

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
    expect(groups(el).map(shape)).toEqual([...source.children].map(shape));
  });

  it("paints the cloche from --wt-color-primary and the word from --wt-color-text", async () => {
    const el = await lockup();
    el.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
    el.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
    expect(groups(el).map((g) => getComputedStyle(g).fill)).toEqual([
      "rgb(1, 2, 3)",
      "rgb(4, 5, 6)",
    ]);
  });

  it.each(["light", "dark"] as const)("follows the %s theme's tokens", async (theme) => {
    const el = (await mountThemed(
      "<wt-waitron-lockup></wt-waitron-lockup>",
      theme,
    )) as WtWaitronLockup;
    await el.updateComplete;
    const tokens = getComputedStyle(el);
    const expected = ["--wt-color-primary", "--wt-color-text"].map((name) => {
      const probe = document.createElement("span");
      probe.style.color = tokens.getPropertyValue(name);
      el.parentElement!.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    expect(groups(el).map((g) => getComputedStyle(g).fill)).toEqual(expected);
  });

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
          `<wt-waitron-lockup style="${size}"></wt-waitron-lockup><span>Casa Delgado</span></div>`,
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
