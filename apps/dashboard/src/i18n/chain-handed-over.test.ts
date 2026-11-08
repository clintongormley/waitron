import { afterEach, expect, it } from "vitest";
import { codeMessage } from "./codes.js";
import { setLocale } from "./t.js";

afterEach(() => setLocale("en-GB"));

it.each([
  [
    "en-GB",
    "This server is no longer the main server, so it cannot add new records for the tax agency. Open this page on the main server.",
  ],
  [
    "es-ES",
    "Este servidor ya no es el servidor principal, así que no puede añadir registros nuevos para Hacienda. Abre esta página en el servidor principal.",
  ],
])("says in %s why a box that is not the main server adds no record", (locale, sentence) => {
  expect(codeMessage("fiscal.chain_handed_over", locale)).toBe(sentence);
});
