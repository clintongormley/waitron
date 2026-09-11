import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-spinner.js";

afterEach(cleanup);

test("is a live status region with an accessible name by default", async () => {
  const el = await mount("<wt-spinner></wt-spinner>");
  const ring = el.shadowRoot!.querySelector("[role=status]")!;
  expect(ring).toBeTruthy();
  expect(ring.getAttribute("aria-label")).toBe("Loading");
});

test("the label property names the status for assistive tech", async () => {
  const el = await mount('<wt-spinner label="Buscando"></wt-spinner>');
  expect(el.shadowRoot!.querySelector("[role=status]")!.getAttribute("aria-label")).toBe(
    "Buscando",
  );
});

test("decorative drops the status role and hides the ring from assistive tech", async () => {
  // Inside a wt-button the button's own aria-busy + label carry the state; a second, English
  // "Loading" live region inside a Spanish "Buscando…" button would be announced too.
  const el = await mount("<wt-spinner decorative></wt-spinner>");
  expect(el.shadowRoot!.querySelector("[role=status]")).toBeNull();
  expect(el.shadowRoot!.querySelector(".ring")!.getAttribute("aria-hidden")).toBe("true");
});

test("the ring paints in the surrounding text colour (currentColor)", async () => {
  const el = await mount("<wt-spinner></wt-spinner>");
  host.style.color = "rgb(12, 34, 56)";
  const ring = el.shadowRoot!.querySelector(".ring")!;
  expect(getComputedStyle(ring).borderTopColor).toBe("rgb(12, 34, 56)");
  expect(getComputedStyle(ring).opacity).toBe("1");
});

test("defaults to the md size and reflects it", async () => {
  const el = await mount("<wt-spinner></wt-spinner>");
  expect(el.getAttribute("size")).toBe("md");
});

test("sizes from the font-size tokens, like wt-icon", async () => {
  const el = await mount('<wt-spinner size="sm"></wt-spinner>');
  host.style.setProperty("--wt-font-size-sm", "37px");
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(getComputedStyle(el).width).toBe("37px");
  expect(getComputedStyle(el).height).toBe("37px");
});
