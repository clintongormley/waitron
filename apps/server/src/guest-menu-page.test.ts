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
  await p.setContent(
    renderGuestMenuPage({ ...menu, language: "fr" }, "The Restaurant", "en", true),
  );
  expect(await p.getByRole("navigation", { name: "Languages" }).getAttribute("lang")).toBe("en");
});

it("paints an unavailable page with the shared guest-page typography", async () => {
  const p = await browser!.newPage();
  onTestFinished(() => p.close());
  await p.setContent(renderGuestMenuUnavailable("en", "en"));
  expect(await p.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("system-ui");
});

it.each(["bistro", "lunch-wine"] as const)(
  "prints %s with paper-only order, breaks and written declarations",
  async (preset) => {
    const p = await browser!.newPage();
    onTestFinished(() => p.close());
    await p.emulateMedia({ media: "print" });
    const dishes: PublicGuestMenu = {
      ...menu,
      members: [...menu.members, { kind: "section", name: "Desserts", members: menu.members }],
    };
    await p.setContent(
      renderGuestMenuPage(dishes, "The Restaurant", "en", false, {
        preset,
        font: "serif",
        spacing: "compact",
        ink: "#123456",
        accent: "#654321",
        key: "end",
        order: [1, 0],
        breaks: [0],
      }),
    );
    expect(await p.locator("[data-paper-member] > h2").allTextContents()).toEqual([
      "Desserts",
      "Starters",
    ]);
    expect(
      await p
        .locator("[data-paper-member]")
        .last()
        .evaluate((el) => getComputedStyle(el).breakBefore),
    ).toBe("page");
    expect(
      await p
        .locator("[data-paper-member] > h2")
        .first()
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe("rgb(101, 67, 33)");
    expect(await p.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
      "Georgia",
    );
    expect(await p.locator("button, [popover], nav").count()).toBe(0);
    expect(await p.locator("article").first().textContent()).toContain("€3.00–€6.00");
    expect(await p.locator("article .declarations").first().textContent()).toContain("Wheat");
    expect(await p.locator("footer").textContent()).toContain("Cereals containing gluten");
    expect(
      await p
        .locator("article")
        .first()
        .evaluate((el) => getComputedStyle(el).breakInside),
    ).toBe("avoid");
    await p.setContent(renderGuestMenuPage(dishes, "The Restaurant", "en"));
    expect(await p.locator("[data-paper-member] > h2").allTextContents()).toEqual([
      "Starters",
      "Desserts",
    ]);
  },
);

it("prints full declaration words when inline words are selected", async () => {
  const p = await browser!.newPage();
  onTestFinished(() => p.close());
  await p.setContent(
    renderGuestMenuPage(menu, "The Restaurant", "en", false, {
      preset: "lunch-wine",
      font: "sans",
      spacing: "comfortable",
      ink: "#123456",
      accent: "#654321",
      key: "inline",
    }),
  );
  const declarations = await p.locator("article .declarations").first().textContent();
  expect(declarations).toContain("Vegan");
  expect(declarations).toContain("Vegetarian");
  expect(await p.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
    "system-ui",
  );
});

it("gives Lunch and wine a wider dishes column and a narrow last-section panel", async () => {
  const p = await browser!.newPage({ viewport: { width: 900, height: 1200 } });
  onTestFinished(() => p.close());
  const section = menu.members[0]!;
  const dishes = {
    ...menu,
    members: [section, { kind: "section" as const, name: "Wine", members: [] }],
  };
  await p.setContent(
    renderGuestMenuPage(dishes, "The Restaurant", "en", false, {
      preset: "lunch-wine",
      font: "sans",
      spacing: "comfortable",
      key: "end",
      ink: "#123456",
      accent: "#654321",
    }),
  );
  const boxes = await p.locator("main > section").evaluateAll((nodes) =>
    nodes.map((n) => ({
      width: n.getBoundingClientRect().width,
      top: n.getBoundingClientRect().top,
    })),
  );
  expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 1.5);
  expect(Math.abs(boxes[0]!.top - boxes[1]!.top)).toBeLessThan(1);
});

it("starts a requested Bistro section on a new saved A4 page", async () => {
  const p = await browser!.newPage();
  onTestFinished(() => p.close());
  const dish = {
    ...menu,
    members: [menu.members[0]!, { kind: "section" as const, name: "Desserts", members: [] }],
  };
  await p.setContent(
    renderGuestMenuPage(dish, "The Restaurant", "en", false, {
      preset: "bistro",
      font: "serif",
      spacing: "compact",
      key: "end",
      ink: "#123456",
      accent: "#654321",
      breaks: [1],
    }),
  );
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: Uint8Array.from(await p.pdf({ preferCSSPageSize: true })),
    useSystemFonts: false,
  });
  onTestFinished(() => loading.destroy());
  const pdf = await loading.promise;
  expect(pdf.numPages).toBe(2);
  const first = await (await pdf.getPage(1)).getTextContent();
  const second = await (await pdf.getPage(2)).getTextContent();
  const text = (items: typeof first.items) => items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text(first.items)).toContain("Starters");
  expect(text(first.items)).not.toContain("Desserts");
  expect(text(second.items)).toContain("Desserts");
});

it("keeps a one-section Lunch-and-wine menu in the wide dishes column", async () => {
  const p = await browser!.newPage({ viewport: { width: 900, height: 1200 } });
  onTestFinished(() => p.close());
  await p.setContent(
    renderGuestMenuPage(menu, "The Restaurant", "en", false, {
      preset: "lunch-wine",
      font: "serif",
      spacing: "compact",
      key: "end",
      ink: "#123456",
      accent: "#654321",
    }),
  );
  const width = await p
    .locator("main > section")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(
    (await p.locator("main").evaluate((el) => el.getBoundingClientRect().width)) * 0.6,
  );
});
