import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { CustomerMenuPhotoSize, PublicGuestMenu } from "@waitron/shared";
import { mountCustomerMenu } from "./main.js";

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
  });
  const main = document.createElement("main");
  main.id = "customer-menu";
  document.body.append(data, main);
  mountCustomerMenu(document);
  return main;
}

afterEach(() => {
  document.querySelector("#customer-menu")?.remove();
  document.querySelector("#customer-menu-data")?.remove();
  document.documentElement.lang = "en";
  delete document.documentElement.dataset.theme;
  document.title = "";
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
    .element(main.getByRole("link", { name: "Español" }))
    .toHaveAttribute("href", "/lunch/es");
  await expect
    .element(main.getByRole("link", { name: "English" }))
    .toHaveAttribute("aria-current", "page");
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

it("opens a single-language snapshot in the fixture palette without a language chooser", async () => {
  document.documentElement.dataset.theme = "dark";
  const main = openMenu("none", {}, { ...menu, language: "es", languages: ["es"] });
  await expect.element(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(document.documentElement.lang).toBe("es");
  expect(main.querySelector("details")).toBeNull();
  const article = main.firstElementChild!.shadowRoot!.querySelector("article")!;
  expect(getComputedStyle(article).color).toBe("rgb(236, 238, 242)");
});
