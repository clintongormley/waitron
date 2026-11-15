import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "./test-helpers.js";
import { holdsTabbable, isTabbable, tabbables } from "./tabbable.js";

afterEach(cleanup);

function place(markup: string): Promise<HTMLElement> {
  return mount(`<div>${markup}</div>`);
}

test("an element is a Tab stop when it is in the tab order, enabled, drawn and not inert", async () => {
  const root = await place(`<button id="plain">Plain</button><div id="stop" tabindex="0">Stop</div>
    <p id="editable" contenteditable>Edit</p><a id="link" href="#x">Link</a>`);
  for (const each of root.querySelectorAll("[id]")) expect(isTabbable(each), each.id).toBe(true);
});

test.each([
  ["text", "<p>Text</p>"],
  ["a link with no address", "<a>Nowhere</a>"],
  ["a button with a negative tabindex", '<button tabindex="-1">Skipped</button>'],
  ["a disabled button", "<button disabled>Off</button>"],
  ["a hidden input", '<input type="hidden">'],
  ["an invisible button", '<button style="visibility: hidden">Invisible</button>'],
  ["a button in an inert element", "<div inert><button>Inert</button></div>"],
])("%s is not a Tab stop", async (_, markup) => {
  const root = await place(markup);
  expect([...tabbables(root)]).toEqual([]);
});

test("an inert host keeps the controls in its shadow root out of the tab order", async () => {
  const root = await place("<div inert></div>");
  const button = document.createElement("button");
  root.firstElementChild!.attachShadow({ mode: "open" }).append(button);
  expect(isTabbable(button)).toBe(false);
});

test("a text node is not a Tab stop", () => {
  expect(isTabbable(document.createTextNode("text"))).toBe(false);
});

test("tabbables lists a host's shadow root first and leaves out what it is told to skip", async () => {
  const root = await place(
    '<div id="host"><button id="light">Light</button></div><button id="skipped">Skip</button>',
  );
  const shadowButton = document.createElement("button");
  const shadow = root.querySelector("#host")!.attachShadow({ mode: "open" });
  shadow.append(shadowButton, document.createElement("slot"));
  expect([...tabbables(root)]).toEqual([
    shadowButton,
    root.querySelector("#light"),
    root.querySelector("#skipped"),
  ]);
  expect([...tabbables(root, new Set([shadow, root.querySelector("#skipped")!]))]).toEqual([
    root.querySelector("#light"),
  ]);
});

test("holdsTabbable finds a Tab stop among the elements or inside them, and nothing in text", async () => {
  const root = await place(
    "<button>Self</button><div><p>Text</p></div><div><a href='#x'>In</a></div>",
  );
  const [self, text, holder] = root.children;
  expect(holdsTabbable([self!])).toBe(true);
  expect(holdsTabbable([text!])).toBe(false);
  expect(holdsTabbable([text!, holder!])).toBe(true);
});
