import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { buildCardProvider } from "./boot.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("buildCardProvider with payments disabled", () => {
  it("does not query a payments table absent from a fresh venue", async () => {
    await expect(buildCardProvider(suite.db, "demo", false, false)).resolves.toBeUndefined();
  });
});
