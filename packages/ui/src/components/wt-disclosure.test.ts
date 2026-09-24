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

test("an open disclosure draws one rounded section border with its title on that border", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen" open><p>body</p></wt-disclosure>');
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  const section = el.shadowRoot!.querySelector<HTMLElement>(".section")!;
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  expect(parseFloat(getComputedStyle(section).borderTopWidth)).toBeGreaterThan(0);
  expect(getComputedStyle(section).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(section).borderRadius).not.toBe("0px");
  expect(getComputedStyle(header).position).toBe("relative");
  expect(parseFloat(getComputedStyle(header).top)).toBeLessThan(0);
});

test("focusing the host delegates focus to the header button", async () => {
  // Without delegation the host itself becomes the active element and nothing inside the shadow
  // root is focused, which is the state every other interactive primitive here avoids.
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("button.header"));
});

test("a disclosure given no heading and no summary writes neither into the header", async () => {
  const el = await mount("<wt-disclosure><p>body</p></wt-disclosure>");
  expect(el.shadowRoot!.querySelector(".heading")!.textContent).toBe("");
  expect(el.shadowRoot!.querySelector(".summary")).toBeNull();
});

test("the header points at a body id that names this component, and two disclosures never share one", async () => {
  const first = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  const second = await mount('<wt-disclosure heading="Descriptors"><p>body</p></wt-disclosure>');
  const idOf = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLElement>(".body")!.id;
  for (const el of [first, second]) {
    expect(idOf(el)).toMatch(/^wt-disclosure-body-\d+$/);
    expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-controls")).toBe(idOf(el));
    // A body id has to survive being used as a selector, which not every legal HTML id does.
    expect(el.shadowRoot!.querySelector(`#${idOf(el)}`)).toBe(
      el.shadowRoot!.querySelector(".body"),
    );
  }
  expect(idOf(first)).not.toBe(idOf(second));
});

test("the header click stays inside the disclosure, so a listener above it sees only wt-toggle", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  let clicks = 0;
  let toggles = 0;
  host.addEventListener("click", () => clicks++);
  host.addEventListener("wt-toggle", () => toggles++);
  el.shadowRoot!.querySelector("button")!.click();
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  expect(toggles).toBe(1);
  expect(clicks).toBe(0);
});
