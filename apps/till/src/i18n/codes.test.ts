import { afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { codeMessage } from "./codes.js";

afterEach(() => {
  // codeMessage's default locale reads t.ts's module-level locale; reset to the shipped default (en-GB)
  // so a setLocale in one test cannot leak into another (order-independence, §4).
  setLocale("en-GB");
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

it("defaults to the module locale when none is passed (shipped default en-GB)", () => {
  expect(codeMessage("swap.not_found")).toBe("That swap could not be found");
  setLocale("es-ES");
  expect(codeMessage("swap.not_found")).toBe("No se ha encontrado ese cambio de turno");
});

it("resolves the device pairing-code errors to specific, actionable copy (device-identity-1 §5a)", () => {
  // The enrol view surfaces a rejected `{ code }` through this resolver, so an operator setting up a
  // display sees why a code was refused (wrong/used vs expired) — never the raw wire code.
  expect(codeMessage("device.pairing_invalid", "en")).toBe(
    "That pairing code is not valid — check it and try again",
  );
  expect(codeMessage("device.pairing_expired", "en")).toBe(
    "That pairing code has expired — ask for a new one",
  );
  expect(codeMessage("device.pairing_invalid", "es")).toBe(
    "Ese código de emparejamiento no es válido. Revísalo e inténtalo de nuevo",
  );
  expect(codeMessage("device.pairing_expired", "es")).toBe(
    "Ese código de emparejamiento ha caducado. Solicita uno nuevo",
  );
  expect(codeMessage("device.unauthorized", "en")).toBe(
    "This display isn't set up — enter a pairing code",
  );
});
