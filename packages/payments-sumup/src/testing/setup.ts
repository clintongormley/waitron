import { withTenant } from "@waitron/db";
import type { PgliteSuite } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./fake-sumup.js";
import { SumUpCloudProvider } from "../provider.js";

const NODE = "11111111-1111-4111-8111-111111111111";

/** The PGlite fixture shared by the hermetic adapter suites (`provider.test.ts`, `reverse.test.ts`):
 * a seeded working order, a `FakeSumUp`, and a provider wired to the seeded tenant. `makeProvider`
 * builds an additional provider for any tenant — the reversal cross-tenant case constructs one for a
 * STRANGER tenant against the same db and fake, to prove a foreign payment is refused before any
 * refund reaches SumUp. `row` reads a payment back by ref (asserting the persisted state). */
export async function setup(suite: PgliteSuite, tune?: (f: FakeSumUp) => void) {
  const t = await seedWorkingOrder(suite.db, freshNif());
  const fake = new FakeSumUp();
  tune?.(fake);
  const makeProvider = (tenantId: TenantId): SumUpCloudProvider =>
    new SumUpCloudProvider({
      client: fake,
      db: suite.db,
      tenantId,
      nodeId: NODE,
      resolveReader: () => Promise.resolve("rdr_1"),
      incidents: () => Promise.resolve(true),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
  const provider = makeProvider(brandTenantId(t.tenantId));
  const params = {
    tenantId: brandTenantId(t.tenantId),
    tillId: brandTillId(t.tillId),
    workingOrderId: brandWorkingOrderId(t.workingOrderId),
    amount: decimal("12.50"),
  };
  const row = async (ref: string) => {
    const r = await withTenant(suite.db, t.tenantId, (tx) =>
      getPaymentByRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: ref }),
    );
    if (r === undefined) throw new Error(`no payments row for ref ${ref}`);
    return r;
  };
  return { t, fake, provider, params, row, makeProvider };
}
