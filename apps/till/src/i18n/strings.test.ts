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

describe("the suspended-account message matches the dashboard's wording", () => {
  // Same person, same refusal, same words on either screen (owner decision — align to the dashboard's
  // existing choice, not a new one). The dashboard's copy lives in apps/dashboard/src/i18n/codes.ts
  // under `person.suspended`; the till renders its OWN catalogue string via `t("person.suspended")` on
  // the lock screen. This test pins the till catalogue to a HARDCODED copy of the dashboard's words, so
  // it catches only a TILL-side edit that drifts from them. It does NOT read codes.ts, so a change to
  // the dashboard's own wording would leave this green and silently reintroduce the drift — this
  // string is the anchor, and the two are kept equal only as long as the dashboard side is not moved.
  it("uses the dashboard's English and Spanish text", () => {
    expect(catalogues["en-GB"]?.["person.suspended"]).toBe(
      "This account is disabled — ask a manager",
    );
    expect(catalogues["es-ES"]?.["person.suspended"]).toBe(
      "Esta cuenta está desactivada. Avisa a un responsable",
    );
  });
});
