import { commands } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface Seen {
  type: string;
  pointerType: string | null;
  target: string;
}

const KINDS = ["pointerdown", "pointermove", "pointerup", "pointercancel", "click"] as const;

let page: HTMLElement;
let seen: Seen[];
const record = (event: Event) => {
  seen.push({
    type: event.type,
    pointerType: event instanceof PointerEvent ? event.pointerType : null,
    target: event.target instanceof Element ? event.target.id || event.target.localName : "?",
  });
};

beforeEach(() => {
  seen = [];
  page = document.createElement("div");
  page.style.height = "4000px";
  page.style.paddingTop = "300px";
  for (const id of ["one", "two"]) {
    const button = document.createElement("button");
    button.id = id;
    button.textContent = id;
    button.style.display = "block";
    button.style.width = "120px";
    button.style.height = "48px";
    page.append(button);
  }
  document.body.append(page);
  window.scrollTo(0, 0);
  for (const kind of KINDS) document.addEventListener(kind, record, true);
});

afterEach(() => {
  for (const kind of KINDS) document.removeEventListener(kind, record, true);
  page.remove();
  window.scrollTo(0, 0);
});

const types = () => seen.map((s) => s.type);
const fromDown = () => types().slice(types().indexOf("pointerdown"));
const pointerTypes = () => new Set(seen.flatMap((s) => (s.pointerType ? [s.pointerType] : [])));

describe("pointer gesture commands", () => {
  it("mouseDrag drives the real mouse and ends in a click", async () => {
    await commands.mouseDrag(["#one", "#two"]);

    expect(pointerTypes()).toEqual(new Set(["mouse"]));
    expect(seen.find((s) => s.type === "pointerdown")?.target).toBe("one");
    expect(seen.find((s) => s.type === "pointerup")?.target).toBe("two");
    expect(fromDown()).toContain("pointermove");
    expect(fromDown().slice(-2)).toEqual(["pointerup", "click"]);
  });

  it("touchGesture with a hold sends touch pointer events", async () => {
    await commands.touchGesture({ at: "#one", holdMs: 100 });

    expect(pointerTypes()).toEqual(new Set(["touch"]));
    expect(types()).toContain("pointerdown");
    expect(types()).toContain("pointerup");
    expect(types()).not.toContain("pointercancel");
  });

  it("touchGesture moving before any hold scrolls the page and cancels the pointer", async () => {
    await commands.touchGesture({ at: "#one", moveBy: { x: 0, y: -200 } });

    expect(pointerTypes()).toEqual(new Set(["touch"]));
    expect(types()).toContain("pointercancel");
    expect(types()).not.toContain("click");
    expect(window.scrollY).toBeGreaterThan(0);
  });
});
