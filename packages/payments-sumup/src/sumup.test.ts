import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { SumUpCloudProvider } from "./provider.js";

const NODE = "11111111-1111-4111-8111-111111111111";

// This suite used to run on real PostgreSQL, connecting as `sumup_probe` — a non-superuser LOGIN
// inheriting `app_user`'s grants — so that a missing INSERT/UPDATE on `payments` would fail here
// and not in `provider.test.ts`, which connected as a superuser holding every grant.
//
// **That reason is GONE and has no replacement.** This engine has no roles, so nothing now checks
// that the adapter's writes would be permitted to an ordinary application role. Its FIRST case
// went with it: "collect() lands a captured row when handed the only Database handle the API can
// build" asserted the same capture `provider.test.ts` already asserts at
// `SumUpCloudProvider.collect > captures: T1 attempting → checkout keyed by our payment_ref → poll
// → T2 captured with SumUp's transaction id`, and once the role is gone the two are the same test
// on the same handle.
//
// The case below is the one thing here that was never about the role — nothing else in this
// package asserts it — so the file stays for it rather than being deleted.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("the sumup cloud adapter's reader requirement", () => {
  it("collect() throws when no readerRef is supplied — a SumUp collect cannot proceed without a reader", async () => {
    // The reader is a per-collect input now; a collect with none is a host wiring error, not a
    // decline. Thrown before any DB write or network call — no attempting row.
    const t = await seedWorkingOrder(suite.db, freshNif());
    const provider = new SumUpCloudProvider({
      client: new FakeSumUp(),
      db: suite.db,
      nodeId: NODE,
      incidents: () => Promise.resolve(true),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    await expect(
      provider.collect({
        tillId: brandTillId(t.tillId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("10.00"),
      }),
    ).rejects.toThrow(/readerRef/);
  });
});
