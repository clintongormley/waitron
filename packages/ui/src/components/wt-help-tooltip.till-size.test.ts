import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";
import "./wt-input.js";
import "./wt-disclosure.js";
import "./wt-modal.js";

const TILL = "--wt-help-badge-target: 32px; --wt-help-badge-size: 24px";

beforeEach(async () => {
  await page.viewport(390, 844);
});

afterEach(async () => {
  cleanup();
  setHelpMode(false);
  await page.viewport(1280, 900);
});

type Updating = HTMLElement & { updateComplete: Promise<unknown>; open: boolean };

async function helpOn(el: Updating): Promise<WtHelpTooltip> {
  const badge = el.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  await badge.updateComplete;
  setHelpMode(true);
  await badge.updateComplete;
  await el.updateComplete;
  expect(badge.checkVisibility()).toBe(true);
  return badge;
}

async function openModal(style: string) {
  const el = (await mount(
    `<wt-modal heading="Product" style="${style}"><wt-input label="Name" name="name">` +
      '<wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Name">What it is called.</wt-help-tooltip>' +
      '</wt-input><wt-button slot="footer">Save</wt-button></wt-modal>',
  )) as Updating;
  el.open = true;
  await el.updateComplete;
  await helpOn(el);
  const root = el.shadowRoot!;
  return {
    body: root.querySelector<HTMLElement>(".body")!,
    footer: root.querySelector<HTMLElement>(".footer.has-content")!,
  };
}

async function openDisclosure(style: string) {
  const el = (await mount(
    `<wt-disclosure heading="Selling" open style="${style}">` +
      '<wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Selling">Who can order it.</wt-help-tooltip>' +
      "<p>Anyone can order</p></wt-disclosure>",
  )) as Updating;
  const badge = await helpOn(el);
  const section = el.shadowRoot!.querySelector<HTMLElement>(".section")!;
  return { badge, section };
}

test("a full-width field's badge in a wt-modal gets no sideways scroll", async () => {
  const { body, footer } = await openModal(TILL);
  const size = { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth };
  expect(size.scrollWidth, JSON.stringify(size)).toBe(size.clientWidth);
  expect(getComputedStyle(body).paddingInlineEnd).toBe("16px");
  expect(getComputedStyle(footer).paddingInlineStart).toBe("16px");
  expect(getComputedStyle(footer).paddingInlineEnd).toBe("16px");
});

test("a wt-disclosure's heading badge stays inside the section's top", async () => {
  const { badge, section } = await openDisclosure(TILL);
  const badgeTop = badge.getBoundingClientRect().top;
  const sectionTop = section.getBoundingClientRect().top;
  expect(badgeTop, JSON.stringify({ badgeTop, sectionTop })).toBeGreaterThanOrEqual(sectionTop);
  expect(getComputedStyle(section).paddingBlockStart).toBe("16px");
  expect(getComputedStyle(section).paddingBlockEnd).toBe("12px");
});

test("the modal's side padding and the disclosure's top padding are unchanged at 24px", async () => {
  const { body, footer } = await openModal("");
  expect(getComputedStyle(body).paddingInlineStart).toBe("12px");
  expect(getComputedStyle(body).paddingInlineEnd).toBe("12px");
  expect(getComputedStyle(footer).paddingInlineEnd).toBe("12px");
  cleanup();
  const { section } = await openDisclosure("");
  expect(getComputedStyle(section).paddingBlockStart).toBe("12px");
  expect(getComputedStyle(section).paddingBlockEnd).toBe("12px");
});
