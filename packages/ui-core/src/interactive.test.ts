import { afterEach, describe, expect, test, vi } from "vitest";
import { LitElement, html } from "lit";
import {
  delegatesFocusShadowRootOptions,
  dispatchWtChange,
  focusFirstInvalid,
  uniqueId,
} from "./interactive.js";
import { cleanup, host, mount } from "./test-helpers.js";
import "./components/wt-input.js";
import "./components/wt-button.js";

class FocusProbeForm extends LitElement {
  static override properties = { error: {} };
  error = "";
  // Renders a task later, so the walk must wait on `updateComplete` rather than on its own
  // microtask turns.
  protected override async scheduleUpdate(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    super.scheduleUpdate();
  }
  override render() {
    return html`<wt-input label="Name" name="name" .error=${this.error}></wt-input>`;
  }
}
customElements.define("focus-probe-form", FocusProbeForm);

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

  test("passes over invalid elements that cannot take focus and focuses the next one", async () => {
    await mount(`<div>
      <input name="hidden" hidden aria-invalid="true" />
      <div aria-invalid="true"><input name="usable" aria-invalid="true" /></div>
    </div>`);

    const focused = await focusFirstInvalid(host);

    expect(focused).toBe(host.querySelector('[name="usable"]'));
    expect(document.activeElement).toBe(focused);
  });

  test("returns null when no invalid element can take focus", async () => {
    await mount(`<div><div aria-invalid="true"></div><input hidden aria-invalid="true" /></div>`);

    expect(await focusFirstInvalid(host)).toBeNull();
  });

  test("focuses a focus-delegating host marked invalid through its inner control", async () => {
    await mount(`<div><wt-button aria-invalid="true">Choose</wt-button></div>`);
    const button = host.querySelector("wt-button")!;

    const focused = await focusFirstInvalid(host);

    expect(focused).toBe(button);
    expect(button.shadowRoot!.activeElement).toBe(button.shadowRoot!.querySelector("button"));
  });

  test("waits for a field a pending render passes its error to, inside that render's shadow root", async () => {
    await mount(`<div><focus-probe-form></focus-probe-form></div>`);
    const form = host.querySelector<FocusProbeForm>("focus-probe-form")!;
    form.error = "Enter a name";

    const focused = await focusFirstInvalid(host);

    const field = form.shadowRoot!.querySelector("wt-input")!;
    expect(focused).toBe(field.shadowRoot!.querySelector("input"));
  });

  test("does not wait on updates after the control it focuses", async () => {
    await mount(`<div><input name="first" aria-invalid="true" /><div id="later"></div></div>`);
    Object.assign(host.querySelector("#later")!, {
      isUpdatePending: true,
      updateComplete: new Promise(() => {}),
    });

    const outcome = await Promise.race([
      focusFirstInvalid(host),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 500)),
    ]);

    expect(outcome).toBe(host.querySelector('[name="first"]'));
  });
});
