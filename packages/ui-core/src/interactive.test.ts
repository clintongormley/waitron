import { afterEach, describe, expect, test, vi } from "vitest";
import { LitElement } from "lit";
import {
  delegatesFocusShadowRootOptions,
  dispatchWtChange,
  focusFirstInvalid,
  uniqueId,
} from "./interactive.js";
import { cleanup, host, mount } from "./test-helpers.js";
import "./components/wt-input.js";

test("uniqueId returns an incrementing, prefix-scoped id", () => {
  // A prefix no component uses, so this is insulated from whatever count the component test
  // suites have already driven the shared counter to.
  const a = uniqueId("interactive-test-prefix");
  const b = uniqueId("interactive-test-prefix");
  expect(a).toBe("interactive-test-prefix-1");
  expect(b).toBe("interactive-test-prefix-2");
});

test("uniqueId keeps different prefixes independent", () => {
  const a = uniqueId("interactive-test-prefix-x");
  const c = uniqueId("interactive-test-prefix-y");
  expect(a).toBe("interactive-test-prefix-x-1");
  expect(c).toBe("interactive-test-prefix-y-1");
});

test("delegatesFocusShadowRootOptions delegates focus without dropping LitElement's own defaults", () => {
  expect(delegatesFocusShadowRootOptions).toEqual({
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  });
  expect(delegatesFocusShadowRootOptions.delegatesFocus).toBe(true);
});

test("dispatchWtChange stops the native event and dispatches a composed, bubbling wt-change", () => {
  const host = document.createElement("div");
  const event = new Event("input");
  const stopSpy = vi.spyOn(event, "stopPropagation");

  let received: CustomEvent<{ value: string }> | undefined;
  host.addEventListener("wt-change", (e) => {
    received = e as CustomEvent<{ value: string }>;
  });

  dispatchWtChange(host, event, { value: "42" });

  expect(stopSpy).toHaveBeenCalledOnce();
  expect(received?.detail).toEqual({ value: "42" });
  expect(received?.bubbles).toBe(true);
  expect(received?.composed).toBe(true);
});

describe("focusFirstInvalid", () => {
  afterEach(cleanup);

  test("focuses the first field marked invalid, inside the fields' own shadow roots", async () => {
    await mount(`<div>
      <wt-input label="Name" name="name"></wt-input>
      <wt-input label="Email" name="email" error="Enter an email address"></wt-input>
      <wt-input label="PIN" name="pin" error="Enter a PIN"></wt-input>
    </div>`);
    const fields = host.querySelectorAll("wt-input");

    const focused = await focusFirstInvalid(host);

    const inner = fields[1]!.shadowRoot!.querySelector("input")!;
    expect(focused).toBe(inner);
    expect(fields[1]!.shadowRoot!.activeElement).toBe(inner);
  });

  test("waits for an error set in the same turn to render before looking", async () => {
    await mount(`<div><wt-input label="Name" name="name"></wt-input></div>`);
    const field = host.querySelector("wt-input")!;
    field.error = "Enter a name";

    const focused = await focusFirstInvalid(host);

    expect(focused).toBe(field.shadowRoot!.querySelector("input"));
  });

  test("finds a native control marked invalid in light DOM", async () => {
    await mount(
      `<div><select name="unit"></select><select name="precision" aria-invalid="true"></select></div>`,
    );

    const focused = await focusFirstInvalid(host);

    expect(focused).toBe(host.querySelector('[name="precision"]'));
    expect(document.activeElement).toBe(focused);
  });

  test("skips a disabled invalid control and returns null when nothing is invalid", async () => {
    await mount(
      `<div><select name="a" aria-invalid="true" disabled></select><input name="b" aria-invalid="false"></div>`,
    );

    expect(await focusFirstInvalid(host)).toBeNull();
  });
});
