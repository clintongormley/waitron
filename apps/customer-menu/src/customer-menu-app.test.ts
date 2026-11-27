import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import {
  contentLanguageDisplayName,
  type CustomerMenuPhotoSize,
  type PublicGuestMenu,
} from "@waitron/shared";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { menuAppearances } from "../test/published-menu.js";
import { mountCustomerMenu } from "./main.js";
import "./main.css";

const image = `${"a".repeat(64)}.webp`;
const photoUrl = "/_customer-menu/photos/roast-pepper.webp";
const menu: PublicGuestMenu = {
  name: "Lunch for guests",
  language: "en",
  languages: ["en", "es"],
  members: [
    {
      kind: "product",
      name: "Roast pepper",
      description: "",
      image,
      price: { min: "6.50", max: "6.50" },
      unit: "",
      allergens: {},
      dietary: [],
      variants: [],
      modifiers: [],
    },
  ],
};

function openMenu(
  photos: CustomerMenuPhotoSize,
  photoUrls: Record<string, string>,
  published = menu,
  appearance?: unknown,
) {
  const data = document.createElement("script");
  data.type = "application/json";
  data.id = "customer-menu-data";
  data.textContent = JSON.stringify({
    address: "lunch",
    defaultLanguage: "en",
    photos,
    menu: published,
    photoUrls,
    appearance,
  });
  const main = document.createElement("main");
  main.id = "customer-menu";
  document.body.append(data, main);
  mountCustomerMenu(document);
  return main;
}

const viewport = [innerWidth, innerHeight] as const;
afterEach(async () => {
  document.querySelector("#customer-menu")?.remove();
  document.querySelector("#customer-menu-data")?.remove();
  document.documentElement.lang = "en";
  document.documentElement.style.removeProperty("color-scheme");
  document.title = "";
  if (innerWidth !== viewport[0] || innerHeight !== viewport[1]) await page.viewport(...viewport);
});

it("reads the published snapshot into the page's main heading and language links", async () => {
  openMenu("large", {});
  const main = page.getByRole("main");
  await expect
    .element(main.getByRole("heading", { level: 1, name: "Lunch for guests" }))
    .toBeVisible();
  expect(document.querySelector("details")?.open).toBe(false);
  await main.getByText("EN", { exact: true }).click();
  await expect
    .element(main.getByRole("link", { name: contentLanguageDisplayName("es", "es") }))
    .toHaveAttribute("href", "/lunch/es");
  await expect
    .element(main.getByRole("link", { name: "English" }))
    .toHaveAttribute("aria-current", "page");
  const current = main.getByRole("link", { name: "English" }).element();
  expect.soft(getComputedStyle(current).textDecorationLine).toBe("none");
  expect(getComputedStyle(current, "::after").content).toContain("✓");
  expect(document.title).toBe("Lunch for guests");
});

it("uses a prepared photo URL from the snapshot", async () => {
  const main = openMenu("small", { [image]: photoUrl });
  await expect
    .poll(() => main.firstElementChild?.shadowRoot?.querySelector("img")?.getAttribute("src"))
    .toBe(photoUrl);
});

it.each([
  { photos: "large", photoUrls: {}, name: "the snapshot has no URL" },
  { photos: "none", photoUrls: { [image]: photoUrl }, name: "Photos is None" },
] as const)("omits the photo when $name", async ({ photos, photoUrls }) => {
  const main = openMenu(photos, photoUrls);
  await expect.element(page.getByRole("button", { name: "Roast pepper" })).toBeVisible();
  expect(main.firstElementChild?.shadowRoot?.querySelector("img")).toBeNull();
});

it("opens a single-language snapshot in the built-in light palette without a language chooser", async () => {
  const main = openMenu("none", {}, { ...menu, language: "es", languages: ["es"] });
  await expect.element(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(document.documentElement.lang).toBe("es");
  expect(main.querySelector("details")).toBeNull();
  const article = main.firstElementChild!.shadowRoot!.querySelector("article")!;
  expect.soft(getComputedStyle(article).color).toBe("rgb(35, 31, 32)");
  expect(getComputedStyle(document.documentElement).colorScheme).toBe("light");
});

it.each([
  { name: "a null style", appearance: null },
  { name: "an unsupported page colour", appearance: { pageColor: "#abc" } },
  { name: "a page colour given as a list", appearance: { pageColor: ["#ffffff"] } },
  { name: "an unsupported font", appearance: { ...menuAppearances.dark, textFont: "display" } },
])(
  "opens the menu in the built-in palette when the snapshot contains $name",
  async ({ appearance }) => {
    const main = openMenu("none", {}, menu, appearance);
    const customer = main.querySelector("customer-menu-page")!;
    await customer.updateComplete;
    const article = customer.shadowRoot!.querySelector("article")!;
    expect(article.querySelector("h1")).toHaveTextContent("Lunch for guests");
    expect.soft(getComputedStyle(article).backgroundColor).toBe("rgb(247, 247, 248)");
    expect(getComputedStyle(document.documentElement).colorScheme).toBe("light");
  },
);

it.each(["light", "dark"] as const)(
  "opens the language chooser in the published %s style",
  async (scheme) => {
    await page.viewport(390, 900);
    const longTitle = { ...menu, name: "Lunch for our guests today" };
    const root = openMenu("none", {}, longTitle, menuAppearances[scheme]);
    const heading = page.getByRole("heading", { level: 1, name: longTitle.name });
    await expect.element(heading).toBeVisible();
    expect.soft(getComputedStyle(document.documentElement).colorScheme).toBe(scheme);
    expect
      .soft(getComputedStyle(heading.element()).color)
      .toBe(scheme === "light" ? "rgb(140, 47, 27)" : "rgb(245, 185, 149)");
    await page.getByText("EN", { exact: true }).click();
    await expect.element(page.getByRole("link", { name: "English" })).toBeVisible();
    const chooser = page.getByRole("navigation", { name: "Languages" }).element();
    const bounds = chooser.getBoundingClientRect();
    expect.soft(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(innerWidth);
    await expectNoA11yViolations(root);
  },
);
