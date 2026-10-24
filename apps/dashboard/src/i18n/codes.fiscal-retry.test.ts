import { afterEach, expect, it } from "vitest";
import { codeMessage } from "./codes.js";
import { setLocale } from "./t.js";

afterEach(() => {
  setLocale("es-ES");
});

it("words the Retry now refusals in English", () => {
  setLocale("en");
  expect(codeMessage("fiscal.not_filing")).toBe(
    "This box does not send records to the tax agency.",
  );
  expect(codeMessage("fiscal.awaiting_certificate")).toBe(
    "No record can be sent until the tax agency's certificate is installed. Install it in Venue settings.",
  );
});

it("words the Retry now refusals in Spanish", () => {
  setLocale("es");
  expect(codeMessage("fiscal.not_filing")).toBe("Este equipo no envía registros a Hacienda.");
  expect(codeMessage("fiscal.awaiting_certificate")).toBe(
    "No se puede enviar ningún registro hasta que se instale el certificado de la AEAT. Instálalo en Ajustes del local.",
  );
});
