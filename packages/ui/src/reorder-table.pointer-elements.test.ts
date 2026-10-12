import { afterEach, expect, it } from "vitest";
import { cleanup, mount } from "./test-helpers.js";
import { pointerElementsAt } from "./reorder-table.js";

afterEach(cleanup);

function centre(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** A fixed box holding a host whose shadow root wraps a slot in a frame and paints a cell of its
 * own beside it, and a nested host inside that shadow root painting a cell of its own. */
async function fixture() {
  const outer = await mount("<div></div>");
  outer.style.cssText = "position:fixed;top:40px;left:40px;width:300px";
  const host = document.createElement("div");
  outer.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<div class="frame"><slot></slot></div><div class="own" style="height:40px">own</div><div class="nested"></div>`;
  const nested = shadow.querySelector<HTMLElement>(".nested")!;
  nested.attachShadow({ mode: "open" }).innerHTML =
    `<span class="deep" style="display:block;height:40px">deep</span>`;
  const slotted = document.createElement("p");
  slotted.style.cssText = "margin:0;height:40px";
  slotted.textContent = "slotted";
  host.append(slotted);
  return { outer, host, shadow, nested, slotted };
}

it("lists a slotted element first, then its slot, the shadow tree around it, its host and every ancestor up to the root", async () => {
  const { outer, host, shadow, slotted } = await fixture();
  const { x, y } = centre(slotted);
  expect(pointerElementsAt(x, y)).toEqual([
    slotted,
    shadow.querySelector("slot"),
    shadow.querySelector(".frame"),
    host,
    outer,
    outer.parentElement,
    document.body,
    document.documentElement,
  ]);
});

it("finds what a shadow root paints under the point, through nested shadow roots", async () => {
  const { outer, host, shadow, nested } = await fixture();
  const own = shadow.querySelector(".own")!;
  expect(pointerElementsAt(centre(own).x, centre(own).y).slice(0, 3)).toEqual([own, host, outer]);
  const deep = nested.shadowRoot!.querySelector(".deep")!;
  expect(pointerElementsAt(centre(deep).x, centre(deep).y).slice(0, 4)).toEqual([
    deep,
    nested,
    host,
    outer,
  ]);
});

it("stops at a host whose shadow root paints nothing under the point", async () => {
  const outer = await mount("<div></div>");
  outer.style.cssText = "position:fixed;top:40px;left:40px;width:200px;height:60px";
  outer.attachShadow({ mode: "open" });
  const { x, y } = centre(outer);
  expect(pointerElementsAt(x, y).slice(0, 2)).toEqual([outer, outer.parentElement]);
});

it("finds nothing outside the viewport", async () => {
  await fixture();
  expect(pointerElementsAt(-50, -50)).toEqual([]);
});
