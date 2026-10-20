import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { helpBadgeLabel, helpEn, helpEs } from "../i18n/help-strings.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, flan, mount, resized, store } from "./till-table-order-screen.test-helpers.js";

let locale = currentLocale();
let viewport = { width: 0, height: 0 };
beforeEach(async () => {
  locale = currentLocale();
  viewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en");
  await page.viewport(1280, 900);
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(viewport.width, viewport.height);
});

async function mountWithLines(over: Partial<TillTableOrderScreen> = {}, theme?: "light" | "dark") {
  const mounted = await mount(over);
  if (theme !== undefined) mounted.host.setAttribute("data-theme", theme);
  // The till's shell sets the badge's size; a screen mounted alone takes the dashboard's.
  mounted.host.style.setProperty("--wt-help-badge-target", "32px");
  mounted.host.style.setProperty("--wt-help-badge-size", "24px");
  mounted.host.style.width = "100%";
  store(mounted.el).addProduct(beer, "2");
  store(mounted.el).addProduct(flan, "1");
  await mounted.el.updateComplete;
  await resized(mounted.el);
  const review = mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review?.checkVisibility()) {
    await userEvent.click(review);
    await mounted.el.updateComplete;
  }
  return mounted;
}

const group = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>(".draft-actions")!;
const badge = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<WtHelpTooltip>(
    `wt-help-tooltip[aria-label="${helpBadgeLabel(t("table.draft_actions"))}"]`,
  );
const isOpen = (tip: WtHelpTooltip) =>
  tip.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");

async function helpOn(el: TillTableOrderScreen): Promise<WtHelpTooltip> {
  setHelpMode(true);
  const tip = badge(el)!;
  await tip.updateComplete;
  return tip;
}

function expectOverCorner(tip: WtHelpTooltip, box: HTMLElement): void {
  const at = tip.getBoundingClientRect();
  const corner = box.getBoundingClientRect();
  expect(at.width).toBeGreaterThan(0);
  expect(at.left + at.width / 2).toBeCloseTo(corner.right, 0);
  expect(at.top + at.height / 2).toBeCloseTo(corner.top, 0);
}

describe("Order's help badge on Fire and Send all", () => {
  it("with help on, Fire and Send all have one badge that takes no room", async () => {
    const { el } = await mountWithLines();
    const off = group(el).getBoundingClientRect().toJSON();
    const tip = await helpOn(el);
    expect(el.shadowRoot!.querySelectorAll(".draft-actions wt-help-tooltip")).toHaveLength(1);
    expectOverCorner(tip, group(el));
    expect(group(el).getBoundingClientRect().toJSON()).toEqual(off);
    const sendAll = el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!;
    expect(off.right).toBeCloseTo(sendAll.getBoundingClientRect().right, 0);
  });

  it.each([
    ["en", helpEn],
    ["es", helpEs],
  ] as const)("its box says what Fire and Send all send (%s)", async (lang, text) => {
    setLocale(lang);
    const { el } = await mountWithLines();
    const tip = await helpOn(el);
    expect(tip.mode).toBe("help-mode");
    expect(tip.textContent).toBe(text["help.order.send"]);
    await userEvent.click(tip.shadowRoot!.querySelector("button")!);
    expect(isOpen(tip)).toBe(true);
  });

  it("Send all still sends with help on", async () => {
    const { el } = await mountWithLines();
    await helpOn(el);
    const submitted = new Promise<SubmitDraftDetail>((resolve) =>
      el.addEventListener(
        "submit-draft",
        (event) => resolve((event as CustomEvent<SubmitDraftDetail>).detail),
        { once: true },
      ),
    );
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    expect((await submitted).lines).toEqual([
      { menuItemId: "offer-beer", quantity: "2" },
      { menuItemId: "offer-flan", quantity: "1" },
    ]);
  });

  it("help off: no badge", async () => {
    const { el } = await mountWithLines();
    const tip = badge(el)!;
    await tip.updateComplete;
    expect(tip.getBoundingClientRect().width).toBe(0);
    expect(getComputedStyle(tip).display).toBe("none");
  });

  it("the handheld's embedded Order tab shows it too, inside the window", async () => {
    await page.viewport(390, 844);
    const { el } = await mountWithLines({ embedded: true, handheld: true });
    const tip = await helpOn(el);
    expectOverCorner(tip, group(el));
    const at = tip.getBoundingClientRect();
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.right).toBeLessThanOrEqual(window.innerWidth);
  });
});

describe.each(["light", "dark"] as const)("Order's help badge a11y (%s theme)", (theme) => {
  it.each([390, 1280])(
    "Fire and Send all with help on at %i px have no violations",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWithLines({}, theme);
      const tip = await helpOn(el);
      expect(tip.getBoundingClientRect().width).toBeGreaterThan(0);
      await expectNoA11yViolations(host);
    },
  );
});
