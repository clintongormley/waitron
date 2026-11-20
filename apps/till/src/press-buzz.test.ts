import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import "@waitron/ui";
import type { WtIconButton } from "@waitron/ui";
import { installPressBuzz } from "./press-buzz.js";
import { setPressBuzz } from "./press-buzz-choice.js";

let root: HTMLDivElement;
let vibrate: Mock<(pattern: number) => boolean>;
let remove: () => void;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
  vibrate = vi.fn(() => true);
  remove = installPressBuzz(root, { vibrate, maxTouchPoints: 1 });
});

afterEach(() => {
  remove();
  root.remove();
});

function press(target: Element): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
}

test("a press on a button buzzes once for 15 ms", () => {
  const button = document.createElement("button");
  button.textContent = "Send";
  root.append(button);
  press(button);
  expect(vibrate.mock.calls).toEqual([[15]]);
});

test("a press on the text inside a button buzzes", () => {
  const button = document.createElement("button");
  const label = document.createElement("span");
  label.textContent = "Send";
  button.append(label);
  root.append(button);
  press(label);
  expect(vibrate.mock.calls).toEqual([[15]]);
});

test("a press on the button inside a shared component buzzes", async () => {
  const iconButton = document.createElement("wt-icon-button") as WtIconButton;
  iconButton.label = "Close";
  iconButton.icon = "close";
  root.append(iconButton);
  await iconButton.updateComplete;
  press(iconButton.shadowRoot!.querySelector("button")!);
  expect(vibrate.mock.calls).toEqual([[15]]);
});

test("a press on a disabled button does not buzz", () => {
  const button = document.createElement("button");
  button.disabled = true;
  root.append(button);
  press(button);
  expect(vibrate).not.toHaveBeenCalled();
});

test("a press on a disabled shared component's button does not buzz", async () => {
  const iconButton = document.createElement("wt-icon-button") as WtIconButton;
  iconButton.label = "Close";
  iconButton.icon = "close";
  iconButton.disabled = true;
  root.append(iconButton);
  await iconButton.updateComplete;
  press(iconButton.shadowRoot!.querySelector("button")!);
  expect(vibrate).not.toHaveBeenCalled();
});

test("a press on an aria-disabled button does not buzz", () => {
  const button = document.createElement("button");
  button.setAttribute("aria-disabled", "true");
  root.append(button);
  press(button);
  expect(vibrate).not.toHaveBeenCalled();
});

test("a press on a button in a disabled fieldset does not buzz", () => {
  const fieldset = document.createElement("fieldset");
  fieldset.disabled = true;
  const button = document.createElement("button");
  fieldset.append(button);
  root.append(fieldset);
  press(button);
  expect(vibrate).not.toHaveBeenCalled();
});

test("a press on a button in a disabled fieldset's legend buzzes", () => {
  const fieldset = document.createElement("fieldset");
  fieldset.disabled = true;
  const legend = document.createElement("legend");
  const button = document.createElement("button");
  legend.append(button);
  fieldset.append(legend);
  root.append(fieldset);
  press(button);
  expect(vibrate.mock.calls).toEqual([[15]]);
});

test("a press still buzzes when part of the button stops the event", () => {
  const button = document.createElement("button");
  const label = document.createElement("span");
  label.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.append(label);
  root.append(button);
  press(label);
  expect(vibrate.mock.calls).toEqual([[15]]);
});

test("a press outside any button does not buzz", () => {
  const text = document.createElement("p");
  text.textContent = "Table 4";
  root.append(text);
  press(text);
  expect(vibrate).not.toHaveBeenCalled();
});

test("a browser without vibration ignores the press", () => {
  remove();
  remove = installPressBuzz(root, { maxTouchPoints: 1 });
  const button = document.createElement("button");
  root.append(button);
  expect(() => press(button)).not.toThrow();
  expect(vibrate).not.toHaveBeenCalled();
});

test.each([
  ["reports no touch points", { maxTouchPoints: 0 }],
  ["does not report touch points", {}],
])("a browser that can vibrate but %s ignores the press", (_, touch) => {
  remove();
  remove = installPressBuzz(root, { vibrate, ...touch });
  const button = document.createElement("button");
  root.append(button);
  press(button);
  expect(vibrate).not.toHaveBeenCalled();
});

test("removing the listener stops the buzz", () => {
  remove();
  const button = document.createElement("button");
  root.append(button);
  press(button);
  expect(vibrate).not.toHaveBeenCalled();
});

test("by default it buzzes through the browser's own navigator", () => {
  remove();
  const ownVibrate = vi.spyOn(navigator, "vibrate").mockReturnValue(true);
  Object.defineProperty(navigator, "maxTouchPoints", { value: 1, configurable: true });
  try {
    remove = installPressBuzz(root);
    const button = document.createElement("button");
    root.append(button);
    press(button);
  } finally {
    delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
  }
  expect(ownVibrate.mock.calls).toEqual([[15]]);
  ownVibrate.mockRestore();
});

test("by default it stays still on the browser's own navigator without a touch screen", () => {
  remove();
  const ownVibrate = vi.spyOn(navigator, "vibrate").mockReturnValue(true);
  Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
  try {
    remove = installPressBuzz(root);
    const button = document.createElement("button");
    root.append(button);
    press(button);
  } finally {
    delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
  }
  expect(ownVibrate).not.toHaveBeenCalled();
  ownVibrate.mockRestore();
});

test("a press does not buzz while the buzz is turned off", () => {
  remove();
  remove = installPressBuzz(root, { vibrate, maxTouchPoints: 1 }, () => false);
  const button = document.createElement("button");
  root.append(button);
  press(button);
  expect(vibrate).not.toHaveBeenCalled();
});

test("the choice is read at each press", () => {
  remove();
  let on = true;
  remove = installPressBuzz(root, { vibrate, maxTouchPoints: 1 }, () => on);
  const button = document.createElement("button");
  root.append(button);
  press(button);
  on = false;
  press(button);
  expect(vibrate.mock.calls).toEqual([[15]]);
});

test("by default it follows the stored choice", () => {
  remove();
  remove = installPressBuzz(root, { vibrate, maxTouchPoints: 1 });
  const button = document.createElement("button");
  root.append(button);
  press(button);
  setPressBuzz(false);
  try {
    press(button);
  } finally {
    setPressBuzz(true);
  }
  expect(vibrate.mock.calls).toEqual([[15]]);
});
