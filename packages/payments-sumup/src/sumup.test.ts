import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { getPaymentByRef, insertAttempting } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { SumUpCloudProvider } from "./provider.js";

// A non-superuser LOGIN role inheriting app_user's grants — created cluster-wide in the package's
// globalSetup (`src/testing/global-setup.ts`), distinct from stripe's `rls_probe` because a shared
// container is one cluster. Its app_user membership is what lets it INSERT/UPDATE `payments` at all
// (the baseline migration's REVOKE ALL + targeted GRANT); PGlite connects as a superuser holding
// every grant, so provider.test.ts cannot show a grant miss — this suite can (CLAUDE.md §4).
const PROBE_ROLE = "sumup_probe";
const PROBE_PASSWORD = "probe";
const NODE = "11111111-1111-4111-8111-111111111111";

const suite = useTemplateDb({ template: "core_payments" });

// `SumUpCloudProvider.collect` never writes `payments` directly — it drives the store's
// attempting/T1.5/capture lifecycle inside transactions IT opens (`insertAttempting` before the
// network, `stampAttemptingRef` after the create, `captureAttempting` on a SUCCESSFUL poll). So the
// adapter, not the store, is the subject: handed the only kind of `Database` handle a host can
// build, it must still land a captured row as an app_user member.
describe("the sumup cloud adapter against a real database", () => {
  it("collect() lands a captured row when handed the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(suite.admin, freshNif());
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new SumUpCloudProvider({
        client: new FakeSumUp(),
        db: probe,
        tenantId: brandTenantId(t.tenantId),
        nodeId: NODE,
        incidents: () => Promise.resolve(true),
        poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
      });
      const result = await provider.collect({
        tenantId: brandTenantId(t.tenantId),
        tillId: brandTillId(t.tillId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("10.00"),
        readerRef: "rdr_1",
      });
      expect(result.state).toBe("captured");
      expect(result.settledAt).toBeInstanceOf(Date);
      expect(result.paymentRef).not.toBe("");
    } finally {
      await probe.close();
    }
  });

  it("collect() throws when no readerRef is supplied — a SumUp collect cannot proceed without a reader", async () => {
    // The reader is a per-collect input now; a collect with none is a host wiring error, not a
    // decline. Thrown after the tenant check, before any DB write or network call — no attempting row.
    const t = await seedWorkingOrder(suite.admin, freshNif());
    const provider = new SumUpCloudProvider({
      client: new FakeSumUp(),
      db: suite.admin,
      tenantId: brandTenantId(t.tenantId),
      nodeId: NODE,
      incidents: () => Promise.resolve(true),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    await expect(
      provider.collect({
        tenantId: brandTenantId(t.tenantId),
        tillId: brandTillId(t.tillId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("10.00"),
      }),
    ).rejects.toThrow(/readerRef/);
  });

  // A second tenant's attempting row for provider "sumup" must still be attempting after this
  // tenant's provider sweeps. The two-tenant probe runs here and not on PGlite because CLAUDE.md
  // §3's till-reroute receipt: only a run as `app_user` on a real cluster caught the by-id leak
  // (PGlite connects as superuser and sees every tenant regardless of the query's own predicate).
  it("resolvePending as app_user resolves only its own tenant's rows (a second tenant's stays attempting)", async () => {
    const a = await seedWorkingOrder(suite.admin, freshNif());
    const b = await seedWorkingOrder(suite.admin, freshNif());
    const fake = new FakeSumUp();
    for (const t of [a, b]) {
      await withTenant(suite.admin, t.tenantId, (tx) =>
        insertAttempting(tx, {
          tenantId: t.tenantId,
          workingOrderId: t.workingOrderId,
          provider: "sumup",
          paymentRef: `ref-${t.tenantId}`,
          amount: decimal("1.00"),
        }),
      );
      fake.hold({
        foreignTransactionId: `ref-${t.tenantId}`,
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
      });
    }
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new SumUpCloudProvider({
        client: fake,
        db: probe,
        tenantId: brandTenantId(a.tenantId),
        nodeId: NODE,
        incidents: () => Promise.resolve(true),
      });
      expect((await provider.resolvePending(new Date())).forwarded).toBe(1);
    } finally {
      await probe.close();
    }
    const stateOf = async (t: typeof a) => {
      const r = await withTenant(suite.admin, t.tenantId, (tx) =>
        getPaymentByRef(tx, {
          tenantId: t.tenantId,
          provider: "sumup",
          paymentRef: `ref-${t.tenantId}`,
        }),
      );
      if (r === undefined) throw new Error(`no payments row for tenant ${t.tenantId}`);
      return r;
    };
    expect((await stateOf(a)).state).toBe("captured");
    expect((await stateOf(b)).state).toBe("attempting");
  });
});
