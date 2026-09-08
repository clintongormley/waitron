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

it("resolves a shut pairing window to its own actionable copy, in both locales (device-join-and-accept §2)", () => {
  // The join screen renders a refused knock through this resolver. `pairing_closed` is the one refusal
  // with a real next step, so it must name the dashboard toggle rather than degrade to the generic.
  expect(codeMessage("device.pairing_closed", "en")).toBe(
    "New devices aren't being accepted right now. Ask a manager to switch on “Allow new devices”.",
  );
  expect(codeMessage("device.pairing_closed", "es")).toBe(
    "Ahora mismo no se aceptan dispositivos nuevos. Pide a un responsable que active «Permitir dispositivos nuevos».",
  );
  expect(codeMessage("device.unauthorized", "en")).toBe(
    "This device isn't set up — ask to join this venue",
  );
});

it("degrades the other join refusals to the generic sentence, naming nothing about the venue", () => {
  // Deliberate: a flood and a full venue leave the operator only "try again", and a specific sentence
  // for either would tell an unapproved device something about the venue's state (design §12).
  expect(codeMessage("device.join_rate_limited", "en")).toBe("Something went wrong, try again");
  expect(codeMessage("device.join_full", "en")).toBe("Something went wrong, try again");
});
