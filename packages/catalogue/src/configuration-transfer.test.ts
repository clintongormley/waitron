import { describe, expect, it } from "vitest";
import { validateCatalogueConfiguration } from "./configuration-transfer.js";

function refusal(code: string, name: string) {
  return expect.objectContaining({ code, params: { field: "name", name } });
}

describe("validateCatalogueConfiguration: category names", () => {
  it("refuses two top-level categories sharing a name, with or without a details row", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "c1", name: "Bebidas" },
          { id: "c2", name: " bebidas " },
        ],
        category_details: [{ category_id: "c2", parent_id: null }],
      }),
    ).toThrowError(refusal("category.name_taken", "bebidas"));
  });

  it("refuses two categories with one parent sharing a name", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "top", name: "Carta" },
          { id: "c1", name: "Postres" },
          { id: "c2", name: "POSTRES" },
        ],
        category_details: [
          { category_id: "c1", parent_id: "top" },
          { category_id: "c2", parent_id: "top" },
        ],
      }),
    ).toThrowError(refusal("category.name_taken", "POSTRES"));
  });

  it("accepts one name under different parents, and a parent sharing its child's name", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "lunch", name: "Lunch" },
          { id: "dinner", name: "Dinner" },
          { id: "c1", name: "Mains" },
          { id: "c2", name: "Mains" },
          { id: "c3", name: "Dinner" },
        ],
        category_details: [
          { category_id: "c1", parent_id: "lunch" },
          { category_id: "c2", parent_id: "dinner" },
          { category_id: "c3", parent_id: "dinner" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("validateCatalogueConfiguration: product names", () => {
  it("refuses an Active variant of an Active product named like another Active product", () => {
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Café Solo", active: 1, parent_id: null },
          { id: "p2", name: "Café", active: 1, parent_id: null },
          { id: "v1", name: " café solo ", active: 1, parent_id: "p2" },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "café solo"));
  });

  it("reads an Active flag written as a boolean as well as 1", () => {
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Agua", active: true, parent_id: null },
          { id: "p2", name: "agua", active: 1, parent_id: null },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "agua"));
  });

  it("does not count an Inactive product, nor a variant of one, nor an Inactive variant", () => {
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Agua", active: 1, parent_id: null },
          { id: "p2", name: "Agua", active: 0, parent_id: null },
          { id: "p3", name: "Zumo", active: false, parent_id: null },
          { id: "v1", name: "Agua", active: 1, parent_id: "p3" },
          { id: "p4", name: "Vino", active: 1, parent_id: null },
          { id: "v2", name: "Agua", active: 0, parent_id: "p4" },
        ],
      }),
    ).not.toThrow();
  });

  it("does not compare a category's name with a product's", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [{ id: "c1", name: "Agua" }],
        products: [{ id: "p1", name: "Agua", active: 1, parent_id: null }],
      }),
    ).not.toThrow();
  });

  it("leaves a name that is not text, and a bundle without the tables, to the other checks", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "c1", name: 7 },
          { id: "c2", name: 7 },
        ],
        products: [
          { id: "p1", name: null, active: 1, parent_id: null },
          { id: "p2", name: null, active: 1, parent_id: null },
        ],
      }),
    ).not.toThrow();
    expect(() => validateCatalogueConfiguration({})).not.toThrow();
  });
});
