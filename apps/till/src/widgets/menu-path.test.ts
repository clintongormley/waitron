import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { DEFAULT_HOME_ORDER, type DocumentMember } from "@waitron/shared";
import type { TillProduct, TillZoneMenu } from "../api/menu-api.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget, resetPage } from "./test-helpers.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import "./menu-browser.js";

const locale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(locale);
  await resetPage();
});

const croquettes: TillProduct = {
  id: "croquettes",
  productId: "p-croquettes",
  menuItemId: "mi-croquettes",
  menuVersionId: "v1",
  name: "Croquettes",
  customerName: { en: "Croquettes" },
  kitchenName: "Croquettes",
  unitPrice: "7.80",
  category: null,
  allergens: null,
};

const cooked: DocumentMember = {
  kind: "section",
  sectionId: "sec-cooked",
  internalName: "cooked",
  names: { en: "Cooked starters", es: "Entrantes calientes" },
  image: null,
  color: null,
  members: [{ kind: "product", productId: "p-croquettes", menuItemId: "mi-croquettes" }],
};
const starters: DocumentMember = {
  kind: "section",
  sectionId: "sec-starters",
  internalName: "starters",
  names: { en: "Starters", es: "Entrantes" },
  image: null,
  color: null,
  members: [cooked],
};

const menu: TillZoneMenu = {
  id: "menu",
  name: "Lunch",
  versionId: "v1",
  isDefault: true,
  orderable: true,
  endedPeriodName: null,
  audience: "customer",
  structure: { members: [starters] },
  home: { shortcuts: [], order: DEFAULT_HOME_ORDER },
};

/** Mounts the browser `width` wide, opened two sections down: Home › Starters › Cooked starters. */
async function opened(width = 390, lang = "en-GB") {
  setLocale(lang);
  await page.viewport(width, 800);
  const { el } = await mountWidget<TillMenuBrowser>("till-menu-browser", {
    menu,
    products: [croquettes],
    store: new WorkingOrderStore(),
  });
  const names = lang.startsWith("es")
    ? ["Entrantes", "Entrantes calientes"]
    : ["Starters", "Cooked starters"];
  for (const name of names) {
    const tile = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button[data-kind]")].find(
      (button) => button.querySelector(".name")?.textContent?.trim() === name,
    )!;
    tile.click();
    await el.updateComplete;
  }
  const nav = el.shadowRoot!.querySelector<HTMLElement>("nav.breadcrumb")!;
  const steps = [...nav.querySelectorAll<HTMLElement>("wt-button")];
  await Promise.all(
    steps.map((step) => (step as HTMLElement & { updateComplete: unknown }).updateComplete),
  );
  const buttons = steps.map((step) => step.shadowRoot!.querySelector("button")!);
  const current = nav.querySelector<HTMLElement>("[aria-current]")!;
  return { el, nav, steps, buttons, current };
}

/** The colour a token paints, read from a probe beside the browser. */
function tokenColour(el: HTMLElement, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  el.parentElement!.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

describe("the menu path", () => {
  it.each([
    ["en-GB", "Home"],
    ["es-ES", "Inicio"],
  ])("starts with a home icon named %s's word, with no visible word", async (lang, name) => {
    const { steps, buttons } = await opened(390, lang);
    const home = page.getByRole("button", { name, exact: true }).element();
    expect(home).toBe(buttons[0]);
    expect(steps[0]!.textContent!.trim()).toBe("");
    expect(buttons[0]!.innerText.trim()).toBe("");
    const icon = buttons[0]!.querySelector("wt-icon")!;
    expect(icon.getAttribute("name")).toBe("home");
    expect(icon.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("names each section after Home and marks the last as where you are", async () => {
    const { steps, current } = await opened();
    expect(steps.slice(1).map((step) => step.textContent!.trim())).toEqual(["Starters"]);
    expect(current.textContent!.trim()).toBe("Cooked starters");
  });

  it("gives every step at least a tap's height", async () => {
    const { buttons, current } = await opened();
    for (const step of [...buttons, current])
      expect(step.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it.each([
    [390, "15px"],
    [719, "15px"],
    [720, "16px"],
    [1280, "16px"],
  ])("writes its steps bold, at %i px wide in %s", async (width, size) => {
    const { buttons, current } = await opened(width);
    for (const step of [buttons[1]!, current]) {
      expect(getComputedStyle(step).fontSize).toBe(size);
      expect(Number(getComputedStyle(step).fontWeight)).toBeGreaterThanOrEqual(600);
    }
  });

  it("paints the earlier steps in the primary text colour and the current one in the text colour", async () => {
    const { el, buttons, current } = await opened();
    const primaryText = tokenColour(el, "--wt-color-primary-text");
    const text = tokenColour(el, "--wt-color-text");
    expect(primaryText).not.toBe(text);
    for (const step of buttons) expect(getComputedStyle(step).color).toBe(primaryText);
    expect(getComputedStyle(current).color).toBe(text);
  });

  it("goes to a step when it is tapped", async () => {
    const { el, steps } = await opened();
    steps[1]!.click();
    await el.updateComplete;
    const nav = () => el.shadowRoot!.querySelector<HTMLElement>("nav.breadcrumb");
    expect(nav()!.querySelector("[aria-current]")!.textContent!.trim()).toBe("Starters");
    nav()!.querySelector<HTMLElement>("wt-button")!.click();
    await el.updateComplete;
    expect(nav()).toBeNull();
  });
});
