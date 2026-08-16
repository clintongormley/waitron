import { afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { codeMessage } from "./codes.js";

afterEach(() => {
  // codeMessage's default locale reads t.ts's module-level locale; reset to the shipped default so a
  // setLocale in one test cannot leak into another (order-independence, §4).
  setLocale("es-ES");
});

it("resolves a known code to friendly copy in English and Spanish", () => {
  expect(codeMessage("absence.overlaps", "en")).toBe(
    "You already have time off that overlaps those dates",
  );
  expect(codeMessage("absence.overlaps", "es-ES")).toBe(
    "Ya tienes una ausencia que se solapa con esas fechas",
  );
});

it("strips the region subtag — es-ES resolves to the es copy", () => {
  expect(codeMessage("swap.not_permitted", "es-ES")).toBe(codeMessage("swap.not_permitted", "es"));
});

it("degrades an UNKNOWN code to the generic sentence, never the raw code", () => {
  const msg = codeMessage("some.unmapped_code", "en");
  expect(msg).toBe("Something went wrong, try again");
  expect(msg).not.toContain("some.unmapped_code");
});

it("degrades a code colliding with an Object.prototype member to the generic sentence", () => {
  // "toString"/"constructor" resolve an inherited method under a bare lookup; Object.hasOwn keeps the
  // guarantee true, so these still map to the generic sentence rather than "[object Object]"/undefined.
  expect(codeMessage("toString", "en")).toBe("Something went wrong, try again");
  expect(codeMessage("constructor", "es")).toBe("Algo salió mal, inténtalo de nuevo");
});

it("defaults to the module locale when none is passed (shipped default es-ES)", () => {
  expect(codeMessage("swap.not_found")).toBe("No se ha encontrado ese cambio de turno");
  setLocale("en");
  expect(codeMessage("swap.not_found")).toBe("That swap could not be found");
});
