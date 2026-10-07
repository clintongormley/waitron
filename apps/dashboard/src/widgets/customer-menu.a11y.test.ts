import { afterEach, describe, expect, it } from "vitest";
import { CustomerMenu } from "./customer-menu.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

afterEach(cleanupWidgets);
const label = (key: string, values?: Readonly<Record<string, string>>) =>
  `${key.replaceAll("_", " ")}${values ? ` ${Object.values(values).join(" ")}` : ""}`;

describe.each(["light", "dark"] as const)("customer menu (%s)", (theme) => {
  it.each([
    "collapsed",
    "expanded",
    "detail",
    "missing translation",
    "failed image",
    "unmet limits",
    "highlighted",
    "included menu shown directly",
  ])("renders %s accessibly", async (state) => {
    const doc = menuDocument(
      [
        ...(state === "included menu shown directly"
          ? [
              {
                kind: "section" as const,
                sectionId: "bar",
                internalName: "Staff bar menu",
                names: { en: "Drinks", es: "Bebidas" },
                image: null,
                color: "#336699",
                includedMenu: { id: "menu-bar", name: "Bar list" },
                direct: true as const,
                members: [documentSection("cold", "Staff cold", [])],
              },
            ]
          : []),
        documentSection("s", "Staff section", [documentProduct("mi", "p")]),
        documentSection("empty", "Empty", []),
      ],
      { p: "Counter burger" },
    );
    const offer = doc.offers.mi!;
    offer.customerName = { en: "House burger" };
    offer.description = { en: "A frozen description" };
    offer.image = "missing.jpg";
    offer.offeredModifiers = [
      {
        kind: "extras",
        id: "extras",
        name: "Staff extras",
        customerName: { en: "Extras" },
        kitchenName: null,
        minPicks: 1,
        maxPicks: 2,
        items: [
          {
            productId: "lemon",
            portion: "1.00",
            unit: offer.unit,
            name: "Staff lemon",
            customerName: { en: "Lemon" },
            kitchenName: null,
            image: null,
            price: "1.50",
            vatClass: offer.vatClass,
            maxQuantity: 1,
            preselected: false,
            addAllergens: null,
            suitableFor: [],
          },
        ],
      },
    ];
    const { el, host } = await mountWidget<CustomerMenu>(
      "dashboard-customer-menu",
      {
        document: doc,
        view: { kind: "customer", language: state === "missing translation" ? "es" : "en" },
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
        label,
        mediaUrl: (f) => `/media/${encodeURIComponent(f)}`,
      },
      theme,
    );
    if (state === "included menu shown directly") {
      el.highlighted = [{ kind: "section", sectionIds: ["bar"], field: { kind: "direct" } }];
      await el.reveal({ kind: "section", sectionIds: ["bar", "cold"], field: { kind: "summary" } });
      expect(
        el.shadowRoot!.querySelector("[data-highlighted] [data-direct] span[lang=en]"),
      ).not.toBeNull();
    } else if (state !== "collapsed")
      await el.reveal(
        state === "expanded"
          ? { kind: "section", sectionIds: ["s"], field: { kind: "summary" } }
          : {
              kind: "product",
              sectionIds: ["s"],
              menuItemId: "mi",
              productId: "p",
              field: { kind: "summary" },
            },
      );
    if (state === "failed image")
      el.shadowRoot!.querySelector<HTMLImageElement>("[data-detail] img")!.dispatchEvent(
        new Event("error"),
      );
    if (state === "highlighted") {
      el.highlighted = [
        {
          kind: "product",
          sectionIds: ["s"],
          menuItemId: "mi",
          productId: "p",
          field: { kind: "price" },
        },
      ];
      await el.reveal(el.highlighted[0]!);
    }
    await expectNoA11yViolations(host);
  });
});
