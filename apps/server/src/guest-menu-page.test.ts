import { afterAll, beforeAll, expect, it, onTestFinished } from "vitest";
import { chromium, type Browser } from "playwright";
import { guestMenuWords, type PublicGuestMenu } from "@waitron/shared";
import { renderGuestMenuPage, renderGuestMenuUnavailable } from "./guest-menu-page.js";
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
          dietary: ["vegan", "vegetarian"],
          variants: [],
          modifiers: [
            {
              kind: "extras",
              name: "Extras",
              items: [
                {
                  name: "Bread",
                  price: "1.50",
                  portion: "2.000",
                  unit: "ea",
                  allergens: null,
                  dietary: [],
                },
                {
                  name: "Oil",
                  price: "1.00",
                  portion: "0.050",
                  unit: "kg",
                  allergens: {},
                  dietary: [],
                },
              ],
            },
          ],
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
  const extras = await page.locator(".choice .line").allTextContents();
  expect.soft(extras[0]).toContain("2 ea");
  expect.soft(extras[1]).toContain("0,05 kg");
  expect.soft(await page.locator("article .declarations small").count()).toBe(0);
  expect.soft(await page.locator("footer svg").count()).toBe(3);
  expect
    .soft(await page.getByRole("button", { name: words.vegetarian, exact: true }).count())
    .toBe(1);
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

it("labels guest language links in their own languages", async () => {
  const p = await browser!.newPage();
  onTestFinished(() => p.close());
  await p.setContent(
    renderGuestMenuPage({ ...menu, language: "es" }, "The Restaurant", "en", true),
  );
  expect(await p.getByRole("navigation", { name: "Idiomas" }).count()).toBe(1);
  expect(await p.locator('a[href="?language=en"]').textContent()).toBe("English");
});

it("paints an unavailable page with the shared guest-page typography", async () => {
  const p = await browser!.newPage();
  onTestFinished(() => p.close());
  await p.setContent(renderGuestMenuUnavailable("en", "en"));
  expect(await p.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("system-ui");
});
