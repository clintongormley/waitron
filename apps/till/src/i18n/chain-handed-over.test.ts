import { afterEach, expect, it } from "vitest";
import { codeMessage } from "./codes.js";
import { setLocale, t } from "./t.js";

afterEach(() => setLocale("en-GB"));

it.each([
  ["en-GB", "This server is no longer the main server, so it cannot record this."],
  ["es-ES", "Este servidor ya no es el servidor principal, así que no puede registrar esto."],
])("says in %s why a box that is not the main server records nothing", (locale, sentence) => {
  expect(codeMessage("fiscal.chain_handed_over", locale)).toBe(sentence);
});

it.each([
  [
    "en-GB",
    "This server is no longer the main server, so it cannot record this payment. If you already charged a card on the terminal, refund it there.",
  ],
  [
    "es-ES",
    "Este servidor ya no es el servidor principal, así que no puede registrar este pago. Si ya has cobrado con tarjeta en el datáfono, devuelve el importe ahí.",
  ],
])("adds the terminal refund advice in %s for a card charged on a terminal", (locale, sentence) => {
  setLocale(locale);
  expect(t("sale.chain_handed_over_manual_card")).toBe(sentence);
});
