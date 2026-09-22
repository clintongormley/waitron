import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./fake-sumup.js";
import { SumUpCloudProvider } from "../provider.js";

const NODE = "11111111-1111-4111-8111-111111111111";

/** The fixture shared by the adapter suites (`provider.test.ts`, `reverse.test.ts`): a seeded
 * working order, a `FakeSumUp`, and a provider wired to the seeded venue (stamped on the incidents
 * it raises). `makeProvider` builds another provider against the same db and fake. `row` reads a
 * payment back by ref (asserting the persisted state).
 *
 * It takes the accessor OBJECT rather than a `Database` because the suites call it inside an `it`
 * body: `useVenueDb`'s `db` getter throws when read before `beforeAll`, and destructuring it at
 * module scope is exactly the mistake that getter exists to catch. */
export async function setup(suite: { readonly db: Database }, tune?: (f: FakeSumUp) => void) {
  const t = await seedWorkingOrder(suite.db, freshNif());
  const fake = new FakeSumUp();
  tune?.(fake);
  const makeProvider = (): SumUpCloudProvider =>
    new SumUpCloudProvider({
      client: fake,
      db: suite.db,
      nodeId: NODE,
      incidents: () => Promise.resolve(true),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
  const provider = makeProvider();
  const params = {
    tillId: brandTillId(t.tillId),
    workingOrderId: brandWorkingOrderId(t.workingOrderId),
    amount: decimal("12.50"),
    // The chosen reader's vendor ref is now a per-collect input, not baked into the provider.
    readerRef: "rdr_1",
  };
  const row = async (ref: string) => {
    const r = await withTransaction(suite.db, (tx) =>
      getPaymentByRef(tx, { provider: "sumup", paymentRef: ref }),
    );
    if (r === undefined) throw new Error(`no payments row for ref ${ref}`);
    return r;
  };
  return { t, fake, provider, params, row, makeProvider };
}
