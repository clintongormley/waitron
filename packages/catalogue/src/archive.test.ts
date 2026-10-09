import { describe, expect, it } from "vitest";
import { documentProductIds } from "./archive.js";
import type { MenuDocument } from "./menu-document-types.js";

const home: MenuDocument["home"] = {
  shortcuts: [],
  handheld: { columns: 3, tiles: "colours", order: "home_first" },
  till: { columns: 6, tiles: "colours", order: "home_first" },
};
const doc = (partial: Partial<MenuDocument>): MenuDocument =>
  ({
    format: 3,
    menuId: "m",
    menuName: "M",
    root: { members: [] },
    offers: {},
    home,
    ...partial,
  }) as MenuDocument;

describe("documentProductIds", () => {
  it("returns no ids for an empty menu with section and empty shortcuts", () => {
    expect(
      documentProductIds(
        doc({
          home: {
            ...home,
            shortcuts: [{ kind: "section", sectionId: "section" }, { kind: "empty" }],
          },
        }),
      ),
    ).toEqual(new Set());
  });

  it("collects each dish, variant, extras item and home shortcut, and no option label", () => {
    const ids = documentProductIds(
      doc({
        offers: {
          o1: {
            productId: "dish",
            variants: [{ id: "size" }],
            offeredModifiers: [
              { kind: "extras", items: [{ productId: "extra" }] },
              { kind: "options", labels: [{ id: "label" }] },
            ],
          },
        } as unknown as MenuDocument["offers"],
        home: {
          ...home,
          shortcuts: [
            { kind: "product", productId: "tile" },
            { kind: "product", productId: "dish" },
            { kind: "empty" },
          ],
        },
      }),
    );
    expect([...ids].sort()).toEqual(["dish", "extra", "size", "tile"]);
  });
});
