import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host, mountInShadowRoot } from "../test-helpers.js";
import { mountThemed } from "../a11y-helpers.js";
import "../index.js";

afterEach(async () => {
  cleanup();
  await page.viewport(1280, 900);
});

test("paints a 56 px bar and keeps its heading centred with a long Back label", async () => {
  await page.viewport(390, 844);
  const element = await mountThemed(
    `
    <wt-top-bar heading="Pay" subtitle="Bill 1" back-label="An unusually long previous screen name">
      <wt-icon-button slot="action" icon="check" label="Equipment"></wt-icon-button>
    </wt-top-bar>`,
    "light",
  );
  host.style.setProperty("--wt-color-surface", "rgb(231, 244, 249)");
  const header = element.shadowRoot?.querySelector("header");
  expect(header).toBeInstanceOf(HTMLElement);
  const heading = header!.querySelector("h2")!;
  expect([...heading.children].map((element) => element.textContent)).toEqual(["Pay", "Bill 1"]);
  const frame = header!.getBoundingClientRect();
  const title = heading.getBoundingClientRect();
  const back = header!.querySelector("wt-button")!;
  const action = element.querySelector("[slot=action]")!;
  expect(getComputedStyle(header!).backgroundColor).toBe("rgb(231, 244, 249)");
  expect(frame.height).toBe(56);
  const chevron = back.querySelector("wt-icon")!.shadowRoot!.querySelector("path")!;
  const mark = chevron.getBoundingClientRect();
  expect(mark.left - frame.left).toBeCloseTo(15, 0);
  expect(mark.width).toBeCloseTo(8, 0);
  expect(mark.height).toBeCloseTo(14, 0);
  expect(title.left + title.width / 2).toBeCloseTo(frame.left + frame.width / 2, 0);
  expect(back.getBoundingClientRect().right).toBeLessThanOrEqual(title.left);
  expect(action.getBoundingClientRect().left).toBeGreaterThanOrEqual(title.right);
});

test.each([
  [337, "Table 4"],
  [390, "Terrace 12"],
])("keeps Back readable at %i px when the title needs to shorten", async (width, label) => {
  const element = await mountThemed(
    `<wt-top-bar heading="An unusually long screen name for a table editor" back-label="${label}">
      <wt-icon-button slot="action" icon="check" label="Equipment"></wt-icon-button>
    </wt-top-bar>`,
    "light",
  );
  host.style.inlineSize = `${width}px`;
  const back = element.shadowRoot!.querySelector<HTMLElement>(".back-label")!;
  const title = element.shadowRoot!.querySelector<HTMLElement>(".title")!;
  const action = element.querySelector("[slot=action]")!;
  expect(back.scrollWidth).toBe(back.clientWidth);
  expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
  expect(back.getBoundingClientRect().right).toBeLessThan(title.getBoundingClientRect().left);
  expect(title.getBoundingClientRect().right).toBeLessThan(action.getBoundingClientRect().left);
});

test("Back emits one composed event from the bar", async () => {
  const bar = await mountInShadowRoot(
    '<wt-top-bar heading="Pay" back-label="Table 4"></wt-top-bar>',
  );
  const heading = bar.shadowRoot!.querySelector("h2")!;
  expect([...heading.children].map((element) => element.textContent)).toEqual(["Pay"]);
  const listener = vi.fn();
  const original = vi.fn();
  document.addEventListener("wt-back", listener);
  document.addEventListener("click", original);
  try {
    const back = bar.shadowRoot?.querySelector("wt-button")?.shadowRoot?.querySelector("button");
    expect(back).toBeInstanceOf(HTMLButtonElement);
    await userEvent.click(back!);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0]).toMatchObject({ bubbles: true, composed: true, detail: {} });
    expect(original).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("wt-back", listener);
    document.removeEventListener("click", original);
  }
});
