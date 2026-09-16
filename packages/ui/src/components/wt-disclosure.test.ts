import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-disclosure.js";

afterEach(cleanup);

test("collapsed by default; body hidden", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  // aria-expanded is the accessible signal; the body element carrying `hidden` is what actually
  // keeps the collapsed content out of the layout and off the a11y tree, so assert it directly.
  expect((el.shadowRoot!.querySelector(".body") as HTMLElement).hidden).toBe(true);
});

test("clicking the header opens it and emits wt-toggle", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  let opened: boolean | undefined;
  el.addEventListener("wt-toggle", (e) => {
    opened = (e as CustomEvent).detail.open;
  });
  el.shadowRoot!.querySelector("button")!.click();
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  expect(opened).toBe(true);
  expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
});

test("wt-toggle bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  // See wt-input.test.ts's identical-purpose test for why the nested-shadow-root + document
  // listener is required to make bubbles and composed both load-bearing (a light-DOM mount()
  // can't distinguish "composed: false" from "composed: true" at all).
  const el = await mountInShadowRoot(
    '<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>',
  );
  let received: CustomEvent<{ open: boolean }> | undefined;
  document.addEventListener(
    "wt-toggle",
    (e) => {
      received = e as CustomEvent<{ open: boolean }>;
    },
    { once: true },
  );

  el.shadowRoot!.querySelector("button")!.click();

  expect(received?.detail.open).toBe(true);
});

test("has-error forces open and blocks collapse", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen" has-error><p>body</p></wt-disclosure>');
  const btn = el.shadowRoot!.querySelector("button")!;
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  let toggles = 0;
  el.addEventListener("wt-toggle", () => toggles++);
  btn.click();
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  expect(btn.getAttribute("aria-expanded")).toBe("true"); // still open
  // The inert header must not fire wt-toggle at all — a consumer listening for it should see
  // nothing, not a toggle that reports the section stayed open.
  expect(toggles).toBe(0);
});

test("summary paints from the muted-text token", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen" summary="Bar"><p>b</p></wt-disclosure>');
  host.style.setProperty("--wt-color-text-muted", "rgb(9, 9, 9)");
  const s = el.shadowRoot!.querySelector(".summary")!;
  expect(getComputedStyle(s).color).toBe("rgb(9, 9, 9)");
});
