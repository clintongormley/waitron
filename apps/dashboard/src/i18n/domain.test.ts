import { afterEach, expect, it } from "vitest";
import {
  allergenName,
  allergenStateName,
  roleName,
  statusName,
  unitName,
  vatClassName,
} from "./domain.js";
import { setLocale } from "./t.js";

afterEach(() => {
  // The resolvers default to t.ts's module-level locale; reset to the shipped
  // default so a setLocale in one test cannot leak into another.
  setLocale("es-ES");
});

it("resolves a role token to Spanish, to English, and passes an unknown value through raw", () => {
  expect(roleName("manager", "es")).toBe("Encargado");
  expect(roleName("manager", "en")).toBe("Manager");
  expect(roleName("staff", "es")).toBe("Empleado");
  expect(roleName("supervisor", "es")).toBe("Supervisor");
  expect(roleName("admin", "es")).toBe("Administrador");
  // Unknown value → the raw value, never a throw or an empty string.
  expect(roleName("wizard", "es")).toBe("wizard");
});

it("resolves a status token to Spanish and English, unknown value raw", () => {
  expect(statusName("active", "es")).toBe("Activo");
  expect(statusName("suspended", "es")).toBe("Suspendido");
  expect(statusName("active", "en")).toBe("Active");
  expect(statusName("frozen", "es")).toBe("frozen");
});

it("resolves a VAT-class token to Spanish and English, unknown value raw", () => {
  expect(vatClassName("general", "es")).toBe("General");
  expect(vatClassName("reduced", "es")).toBe("Reducido");
  expect(vatClassName("super_reduced", "es")).toBe("Superreducido");
  expect(vatClassName("zero", "es")).toBe("Cero");
  expect(vatClassName("reduced", "en")).toBe("Reduced");
  expect(vatClassName("luxury", "es")).toBe("luxury");
});

it("resolves a unit token to Spanish and English, unknown value raw", () => {
  expect(unitName("each", "es")).toBe("Por unidad");
  expect(unitName("weight", "es")).toBe("Por peso");
  expect(unitName("weight", "en")).toBe("By weight");
  expect(unitName("litre", "es")).toBe("litre");
});

it("resolves an allergen-state token to Spanish and English, unknown value raw", () => {
  expect(allergenStateName("pending", "es")).toBe("Pendiente");
  expect(allergenStateName("none", "es")).toBe("Ninguno");
  expect(allergenStateName("declared", "es")).toBe("Declarado");
  expect(allergenStateName("declared", "en")).toBe("Declared");
  expect(allergenStateName("unknown-state", "es")).toBe("unknown-state");
});

it("renders the three allergen states as DISTINCT text (never colour-only, a11y)", () => {
  // pending/none/declared must be visually and textually different so a screen reader
  // and a colour-blind operator can tell them apart without relying on colour.
  const states = new Set([
    allergenStateName("pending", "es"),
    allergenStateName("none", "es"),
    allergenStateName("declared", "es"),
  ]);
  expect(states.size).toBe(3);
});

it("resolves an allergen code to Spanish and English, unknown code raw", () => {
  expect(allergenName("gluten", "es")).toBe("Cereales con gluten");
  expect(allergenName("crustaceans", "es")).toBe("Crustáceos");
  expect(allergenName("nuts", "es")).toBe("Frutos de cáscara");
  expect(allergenName("sulphites", "es")).toBe("Dióxido de azufre y sulfitos");
  expect(allergenName("gluten", "en")).toBe("Cereals containing gluten");
  expect(allergenName("kryptonite", "es")).toBe("kryptonite");
});

it("passes a prototype-chain token (toString/constructor) through raw, never undefined", () => {
  // A token colliding with an Object.prototype member must fall back to the raw value like any other
  // unknown token — a bare `table[value]` would resolve the inherited method (truthy) and return
  // undefined instead of the raw token. The own-key check is what keeps the raw fallback correct.
  expect(roleName("toString", "es")).toBe("toString");
  expect(allergenName("constructor", "es")).toBe("constructor");
  expect(vatClassName("valueOf", "en")).toBe("valueOf");
});

it("falls back to English for a known value in an unknown language", () => {
  // "fr" is not a column, so the `?? table[value]?.en` arm fires — proven across resolvers.
  expect(roleName("manager", "fr")).toBe("Manager");
  expect(allergenName("milk", "fr")).toBe("Milk");
});

it("strips a region subtag before the language lookup", () => {
  // "es-ES" → "es"; proves the region strip runs before indexing the table.
  expect(roleName("admin", "es-ES")).toBe("Administrador");
});

it("defaults to the active locale when none is passed", () => {
  // No locale arg → currentLocale(). The shipped default is es-ES; setLocale drives it.
  expect(roleName("manager")).toBe("Encargado");
  expect(statusName("active")).toBe("Activo");
  expect(vatClassName("zero")).toBe("Cero");
  expect(unitName("each")).toBe("Por unidad");
  expect(allergenStateName("none")).toBe("Ninguno");
  expect(allergenName("eggs")).toBe("Huevos");
  setLocale("en");
  expect(roleName("manager")).toBe("Manager");
});
