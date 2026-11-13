import { afterAll, beforeAll, expect, it, onTestFinished } from "vitest";
import { chromium, type Browser } from "playwright";
import { guestMenuWords, type PublicGuestMenu } from "@waitron/shared";
import { renderGuestMenuPage } from "./guest-menu-page.js";
let browser: Browser | undefined;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
const menu: PublicGuestMenu = {
  name: "Lunch",
  language: "en",
  languages: ["en", "es"],
  members: [
    {
      kind: "section",
      name: "Starters",
      members: [
        {
          kind: "product",
          name: '<img src=x onerror="alert(1)">',
          description: "Soup & bread",
          price: { min: "3.00", max: "6.00" },
          unit: "ea",
          allergens: { gluten: { kinds: ["wheat"] } },
          dietary: ["vegan"],
          variants: [],
          modifiers: [],
        },
      ],
    },
  ],
};
it("renders escaped guest content and section links in the chosen language", async () => {
  const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
  onTestFinished(() => page.close());
  await page.setContent(renderGuestMenuPage({ ...menu, language: "es" }, "The Restaurant", "en"));
  expect(await page.locator("body").textContent()).toContain('<img src=x onerror="alert(1)">');
  expect(await page.locator("img").count()).toBe(0);
  expect(await page.locator("article .line").first().textContent()).toContain("3,00");
  expect(await page.locator("article .line").first().textContent()).toContain("6,00");
  const words = guestMenuWords("es", "en").text;
  expect(await page.locator("body").textContent()).toContain(`${words.gluten} (${words.wheat})`);
  const href = await page.locator("nav a").getAttribute("href");
  expect(await page.locator(href!).textContent()).toContain("Starters");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
it("opens explanations only on activation, with keyboard and Escape dismissal", async () => {
  const page = await browser!.newPage();
  onTestFinished(() => page.close());
  await page.setContent(renderGuestMenuPage(menu, "The Restaurant", "en"));
  const button = page.locator("button[popovertarget]").first();
  await button.focus();
  expect(await page.locator(":popover-open").count()).toBe(0);
  await button.press("Enter");
  expect(await page.locator(":popover-open").count()).toBe(1);
  await button.press("Escape");
  expect(await page.locator(":popover-open").count()).toBe(0);
  await button.press("Space");
  expect(await page.locator(":popover-open").count()).toBe(1);
});
