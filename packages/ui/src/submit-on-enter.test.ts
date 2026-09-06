import { userEvent } from "@vitest/browser/context";
import { afterEach, expect, it, vi } from "vitest";
import { submitOnEnter } from "./submit-on-enter.js";
import "./components/wt-input.js";
import "./components/wt-button.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

async function fixture() {
  const host = document.createElement("div");
  hosts.push(host);
  const field = document.createElement("wt-input");
  const button = document.createElement("wt-button");
  host.append(field, button);
  document.body.append(host);
  await field.updateComplete;
  await button.updateComplete;
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  host.addEventListener("keydown", (e) => submitOnEnter(e, button));
  return { host, input: field.shadowRoot!.querySelector("input")!, button, clicked };
}

it("activates the explicit action once across a shadow boundary and prevents native submission", async () => {
  const { input, clicked } = await fixture();
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  expect(clicked).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
});

it.each([
  { key: "Escape" },
  { key: "Enter", repeat: true },
  { key: "Enter", isComposing: true },
  { key: "Enter", shiftKey: true },
  { key: "Enter", ctrlKey: true },
  { key: "Enter", altKey: true },
  { key: "Enter", metaKey: true },
])("ignores non-submitting key gestures %j", async (init) => {
  const { input, clicked } = await fixture();
  input.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, composed: true }));
  expect(clicked).not.toHaveBeenCalled();
});

it.each(["textarea", "select", "button", "div"])(
  "leaves Enter on %s to the control",
  async (tag) => {
    const { host, clicked } = await fixture();
    const control = document.createElement(tag);
    host.append(control);
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(clicked).not.toHaveBeenCalled();
  },
);

it.each([
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "submit",
  "button",
  "reset",
  "hidden",
  "image",
])("does not submit from input type %s", async (type) => {
  const { input, clicked } = await fixture();
  input.type = type;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(clicked).not.toHaveBeenCalled();
});

it("ignores disabled inputs, disabled actions and handled events", async () => {
  const { input, button, clicked } = await fixture();
  const press = () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  input.disabled = true;
  press();
  input.disabled = false;
  button.disabled = true;
  press();
  button.disabled = false;
  input.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  press();
  expect(clicked).not.toHaveBeenCalled();
});

it("keeps a real multiline Enter as a newline without submitting", async () => {
  const { host, clicked } = await fixture();
  const textarea = document.createElement("textarea");
  host.append(textarea);
  textarea.value = "First line";
  textarea.focus();
  await userEvent.keyboard("{End}{Enter}Second line");
  expect(textarea.value).toBe("First line\nSecond line");
  expect(clicked).not.toHaveBeenCalled();
});

it("leaves Enter unhandled when its explicit action is missing", async () => {
  const { input, clicked } = await fixture();
  const errors: unknown[] = [];
  input.addEventListener("keydown", (event) => {
    try {
      submitOnEnter(event, null);
    } catch (error) {
      errors.push(error);
    }
    event.stopPropagation();
  });
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(clicked).not.toHaveBeenCalled();
  expect(errors).toEqual([]);
});
