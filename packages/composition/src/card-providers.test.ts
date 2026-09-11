import { describe, expect, it } from "vitest";
import { selectCardProviders } from "@waitron/payments";
import { CARD_PROVIDERS } from "./card-providers.js";

describe("CARD_PROVIDERS", () => {
  it("keys by providerId with no duplicate", () => {
    const byId = selectCardProviders(CARD_PROVIDERS);
    expect([...byId.keys()]).toEqual(["sumup", "stripe"]);
    expect(byId.size).toBe(CARD_PROVIDERS.length);
  });
});
