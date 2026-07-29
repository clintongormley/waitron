// Records exactly one real sale through the real Veri*Factu backend, then exits.
//
// There is no till application in this repository yet — this is the only way to put a real sale
// into the fiscal chain, so `apps/server`'s drain loop has something to submit. Deliberately NOT
// a till: one line, one tender, one sale, no loop, no menu, no argument that would let it record
// more than the single line it was invoked for.
//
// Backend construction mirrors `packages/fiscal-verifactu/src/write-path.e2e.test.ts` exactly —
// `VerifactuBackendOptions` has several construction sites in this repo, and the wrong shape
// silently produces a different chain rather than a compile error. `resolveClient` is supplied
// but never called: `recordSale` never contacts AEAT (that is `drain`'s job, run later by
// `apps/server` itself), so the stub below throws if it is ever reached at all.
//
// Usage — build first, exactly like `dist/server.js`; this repo's `.js`-suffixed relative
// imports (this file's own included) resolve through esbuild's bundler, not through plain
// `node <file>.ts`, which cannot follow a `./record-sale.js` specifier back to the sibling
// `record-sale.ts` it actually names (confirmed empirically — see this task's own report):
//   pnpm --filter @waitron/server build
//   DATABASE_URL=postgres://... node apps/server/dist/record-one-sale.js \
//     <tenantId> <tillId> <seriesId> <description> <baseAmount> <vatRate> [tipAmount]
//
// `baseAmount` is the line's tax-EXCLUSIVE amount (quantity is always 1 — this script records one
// line, never a basket). `vatRate` is a percentage literal, e.g. "10.00" meaning 10%. `tipAmount`
// defaults to "0.00". The connection string is read ONLY from `DATABASE_URL`, never accepted as
// an argument — a script that took one would put it in shell history and process listings
// alongside the sale's own amounts.
import { randomUUID } from "node:crypto";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { createPostgresDb, withTenant } from "@waitron/db";
import { deploymentEnvironment } from "../src/config.js";
import {
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  MONEY_SCALE,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";

// The deli's operating locale. Not an argument: this script is not a general-purpose till, and
// every tenant this plan touches operates in Spanish.
const LOCALE = "es-ES";

function usageError(message: string): never {
  console.error(`record-one-sale: ${message}`);
  console.error(
    "usage: DATABASE_URL=<...> node apps/server/dist/record-one-sale.js " +
      "<tenantId> <tillId> <seriesId> <description> <baseAmount> <vatRate> [tipAmount]",
  );
  process.exit(1);
}

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored.
 * This is a one-shot admin script executed directly on a host whose own system clock is the thing
 * being trusted, not a PWA subject to device drift — there is no prior anchor to restore and no
 * monotonic source to compare it against, so there is nothing `createTrustedClock`
 * (`@waitron/fiscal`) would add here.
 *
 * `anchor`/`currentAnchor` are stubs, never called: `recordSale` reads `now()` exactly once and
 * touches neither of the others — the identical shape `write-path-fixtures.ts`'s own
 * `steadyClock` documents for the same reason.
 */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("record-one-sale: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 6 && args.length !== 7) {
    usageError(`expected 6 or 7 arguments, got ${args.length}`);
  }
  const [tenantArg, tillArg, seriesArg, description, baseAmountArg, vatRateArg, tipArg] = args;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    usageError("DATABASE_URL must be set in the environment");
  }

  const tenant = brandTenantId(tenantArg);
  const till = brandTillId(tillArg);
  const series = brandSeriesId(seriesArg);

  const baseAmount = decimal(baseAmountArg);
  const vatRate = decimal(vatRateArg);
  const tipAmount = decimal(tipArg ?? "0.00");

  // The same formula `packages/core/src/vat.ts`'s `percentOf` applies internally (multiply, then
  // divide by 100, rounded to money scale) — reproduced here, rather than imported, because
  // `percentOf` is not part of `@waitron/core`'s public surface (`src/index.ts`). Using the
  // identical formula is what keeps this computed `total` agreeing with the VAT breakdown
  // `recordSale` derives independently from `lines` — a caller-supplied total that disagreed
  // would not fail loudly (there is no CHECK constraint comparing the two), it would just be
  // wrong.
  const tax = divideDecimal(multiplyDecimal(baseAmount, vatRate), decimal("100"), MONEY_SCALE);
  const total = addDecimal(baseAmount, tax);
  const amountCharged = addDecimal(total, tipAmount);

  const db = await createPostgresDb(databaseUrl);
  try {
    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db,
      // `VerifactuBackendOptions.environment` defaults to `"production"`, which is the wrong default
      // for a script whose whole plan is pre-production only. `deploymentEnvironment` is the host's
      // own resolver and defaults the other way, deliberately: config.ts calls it "the one default
      // in the file whose mistake is irreversible", because production numbering can never be
      // reused. It decides only which QR validation host `verificationUrl` names — this script
      // never contacts AEAT — but that URL is the one thing it prints for a human to act on.
      environment: deploymentEnvironment(process.env),
      // Which environment this script is generating the registro FOR — the fact `drain` (Task 6)
      // will refuse to submit if it disagrees with the host it eventually runs on. Same resolver,
      // same host config, different field: this one is never read for the QR host and is stored on
      // the row itself, never hashed (`entorno`, ./schema/registros.ts).
      deploymentEnvironment: deploymentEnvironment(process.env),
      // Never invoked by `recordSale` (see this file's header comment) — a rejection here would
      // only ever surface a bug in this script or in the backend, not a real AEAT contact.
      resolveClient: () =>
        Promise.reject(
          new Error("record-one-sale: resolveClient must never be called by recordSale"),
        ),
    });

    const input: RecordSaleInput = {
      tenantId: tenant,
      tillId: till,
      seriesId: series,
      // Audit-trail context only — `sales` carries no foreign key onto `working_orders` at all,
      // and this script has no working order to point at (`write-path-fixtures.ts`'s
      // `seedTenantWithSif` makes the identical choice, for the identical reason).
      workingOrderId: brandWorkingOrderId(randomUUID()),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total,
      tipAmount,
      lines: [
        {
          lineNo: 1,
          descriptions: { [LOCALE]: description },
          quantity: "1",
          unitPrice: baseAmount,
          vatRate,
          lineTotal: baseAmount,
        },
      ],
      tenders: [{ method: "cash", amount: amountCharged, settledAt: clock.now().instant }],
      fiscalBackend: "verifactu",
      clock,
    };

    const result = await withTenant(db, tenant, (tx) => recordSale(tx, backend, input));

    console.log(`saleId: ${result.saleId}`);
    console.log(`fiscalRecordId: ${result.fiscal.recordId}`);
    console.log(`fiscalState: ${result.fiscal.state}`);
    if (result.fiscal.verificationUrl !== undefined) {
      console.log(`verificationUrl: ${result.fiscal.verificationUrl}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("record-one-sale: failed");
  console.error(error);
  process.exit(1);
});
