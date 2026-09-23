import { expect, test, vi } from "vitest";
import { LitElement } from "lit";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "./interactive.js";

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
