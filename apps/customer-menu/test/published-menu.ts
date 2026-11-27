import type { CustomerMenuPreview, PublicGuestMenu } from "@waitron/shared";

export const menuAppearances = {
  light: {
    pageColor: "#faf4e8",
    textColor: "#2b211b",
    headingColor: "#852b25",
    headingFont: "serif",
    textFont: "system",
  },
  dark: {
    pageColor: "#1f2928",
    textColor: "#f5f1e7",
    headingColor: "#f5b995",
    headingFont: "system",
    textFont: "serif",
  },
} as const;

export const photoReference = `${"a".repeat(64)}.webp`;

export function published(
  language = "en",
  name = "Lunch for guests",
): Extract<CustomerMenuPreview, { state: "published" }> {
  const member: PublicGuestMenu["members"][number] = {
    kind: "product",
    name: "Roast pepper",
    description: "Wood-fired with olive oil",
    image: photoReference,
    price: { min: "6.50", max: "8.50" },
    unit: "",
    allergens: { fish: {} },
    dietary: [],
    variants: [
      {
        name: "Large",
        price: "8.50",
        unit: "",
        allergens: { gluten: { kinds: ["wheat"] } },
        dietary: ["vegan"],
      },
    ],
    modifiers: [
      { kind: "options", name: "Cooking", labels: ["Wood-fired", "Roasted"] },
      {
        kind: "extras",
        name: "Sides",
        items: [
          {
            name: "Almond dressing",
            price: "1.00",
            portion: "0.200",
            preselected: false,
            unit: "kg",
            allergens: { nuts: { kinds: ["almonds"] } },
            dietary: ["vegetarian"],
          },
        ],
      },
    ],
  };
  return {
    state: "published",
    menu: {
      name,
      language,
      languages: ["en", "es"],
      members: [
        {
          kind: "set_menu",
          name: "Two courses",
          price: "18.50",
          lines: [
            {
              count: 2,
              courses: ["House vegetarian main course", "Classic garden salad"],
              choices: [
                { name: "Side salad", price: "0.00", unit: "", allergens: {}, dietary: [] },
                {
                  name: "Noodles (Large)",
                  price: "2.50",
                  unit: "",
                  allergens: { eggs: {}, gluten: { kinds: ["wheat"] } },
                  dietary: [],
                },
              ],
            },
            { count: 1, courses: ["Dessert"], choices: [] },
          ],
        },
        {
          kind: "section",
          name: "From the oven",
          members: [
            member,
            {
              ...member,
              name: "House bread",
              image: null,
              allergens: null,
              variants: [],
              modifiers: [],
            },
          ],
        },
      ],
    },
  };
}

export function publishedSections() {
  const answer = published();
  if (answer.state !== "published") throw new Error("Expected a published menu");
  const oven = answer.menu.members[1]!;
  if (oven.kind !== "section") throw new Error("Expected the oven section");
  const [pepper, bread] = oven.members;
  oven.members = [bread!, { kind: "section", name: "Vegetables", members: [pepper!] }];
  answer.menu.members.push(
    ...["From the oven", "Small plates to share", "From the garden", "Desserts and coffee"].map(
      (name): PublicGuestMenu["members"][number] => ({
        kind: "section",
        name,
        members: [{ ...bread!, name: `Bread for ${name}` }],
      }),
    ),
  );
  return answer;
}
