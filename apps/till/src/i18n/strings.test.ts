import { describe, expect, it } from "vitest";
import { catalogues } from "./strings.js";

/**
 * The permanent-refusal messages, checked as PROSE in every language the till ships, which a
 * rendered-banner test cannot do: the app renders one locale at a time, and the venue default in the
 * app tests is Spanish, so an English word asserted there passes or fails for the wrong reason.
 *
 * What is pinned is the one fact a wrong sentence here costs real money. `sale.refused` is shown on
 * the four handlers that settle a sale, and every one of them may ALREADY have taken the customer's
 * money: `confirm-payment` and `collect-order` carry a manual bank-terminal charge the operator put
 * through before keying its number into the till (`widgets/tender-pay.ts`), and `collect-card`
 * reaches the fiscal record only after the integrated terminal captured (`finalizeCapture`,
 * `apps/server/src/till-sale.ts`). The first draft of this message ended "Nothing was charged",
 * which is false in exactly the state the message exists for. So each language must name its own
 * word for the card terminal — "terminal" in English, "datáfono" in Spanish — and must not tell the
 * operator no money was taken.
 *
 * `place.refused` is the opposite case and is checked for the opposite property: placing an order
 * takes no tender, so a refund instruction would be wrong there.
 */
describe("the permanent-refusal messages", () => {
  it.each([
    ["en-GB", /terminal/i, /nothing was charged/i],
    ["es-ES", /datáfono/i, /no se ha cobrado nada/i],
  ])(
    "sale.refused (%s) names the card terminal and never claims no money was taken",
    (locale, terminalWord, falseMoneyClaim) => {
      const message = catalogues[locale]?.["sale.refused"];
      expect(message).toBeDefined();
      expect(message!).toMatch(terminalWord);
      expect(message!).not.toMatch(falseMoneyClaim);
    },
  );

  it.each([
    ["en-GB", /terminal|refund/i],
    ["es-ES", /datáfono|devuelve/i],
  ])(
    "place.refused (%s) says nothing about money — placing takes no tender",
    (locale, moneyWords) => {
      const message = catalogues[locale]?.["place.refused"];
      expect(message).toBeDefined();
      expect(message!).not.toMatch(moneyWords);
    },
  );

  it("keeps the two apart — a permanent refusal on placing is not the settle message", () => {
    // Wiring `#onPlaceOrder` to `sale.refused` would tell an operator who took no money to refund a
    // card. The handler tests pin which key each surface uses; this pins that they differ at all.
    expect(catalogues["en-GB"]?.["place.refused"]).not.toBe(catalogues["en-GB"]?.["sale.refused"]);
  });
});
