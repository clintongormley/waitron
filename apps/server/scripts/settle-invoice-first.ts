// Walks the invoice-first + correction + settle loop end to end, then exits. Issues an invoice-first
// (deferred) sale, prints it as outstanding, corrects it with a rectificativa, prints the reduced
// amount outstanding, settles at the net, prints an empty outstanding list. There is no till app yet
// — this is the only way to see the deferred/settle path run against the real backend.
//
// Prerequisites, same as record-one-sale.ts plus a rectificative series: the tenant/till/node/
// standard-series/rectificative-series must already exist and the node's SIF be registered.
//
// Usage — build first (this repo's .js-suffixed relative imports resolve through esbuild's bundler,
// not plain `node <file>.ts`):
//   pnpm --filter @waitron/server build
//   DATABASE_URL=postgres://... WAITRON_ENV=production|preproduction \
//     node apps/server/dist/settle-invoice-first.js \
//     <tenantId> <tillId> <nodeId> <standardSeriesId> <rectificativeSeriesId>
//
// The connection string is read ONLY from DATABASE_URL. WAITRON_ENV is REQUIRED (it stamps the
// unrecoverable `entorno` onto the chain) — see record-one-sale.ts's header for why no default.
import { listOutstandingSales, recordCorrection, recordSale, settleSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
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
  negateDecimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { randomUUID } from "node:crypto";

const LOCALE = "es-ES";

function usageError(message: string): never {
  console.error(`settle-invoice-first: ${message}`);
  console.error(
    "usage: DATABASE_URL=<...> WAITRON_ENV=<production|preproduction> " +
      "node apps/server/dist/settle-invoice-first.js " +
      "<tenantId> <tillId> <nodeId> <standardSeriesId> <rectificativeSeriesId>",
  );
  process.exit(1);
}

// Same one-shot host clock as record-one-sale.ts (anchor/currentAnchor are never called by these
// write paths).
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
      throw new Error("settle-invoice-first: anchor() is not used");
    },
    currentAnchor: () => null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 5) {
    usageError(`expected 5 arguments, got ${args.length}`);
  }
  const [tenantArg, tillArg, nodeArg, stdSeriesArg, rectSeriesArg] = args;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    usageError("DATABASE_URL must be set in the environment");
  }
  const rawEnv = process.env.WAITRON_ENV;
  if (rawEnv === undefined || rawEnv === "") {
    usageError("WAITRON_ENV must be set in the environment (production or preproduction)");
  }

  const tenant = brandTenantId(tenantArg);
  const till = brandTillId(tillArg);
  const node = brandNodeId(nodeArg);
  const stdSeries = brandSeriesId(stdSeriesArg);
  const rectSeries = brandSeriesId(rectSeriesArg);

  const rate = decimal("10.00");
  const saleBase = decimal("100.00");
  const saleTax = divideDecimal(multiplyDecimal(saleBase, rate), decimal("100"), MONEY_SCALE);
  const saleTotal = addDecimal(saleBase, saleTax); // 110.00

  const reduceBase = decimal("10.00");
  const corrBase = negateDecimal(reduceBase); // -10.00
  const corrTax = divideDecimal(multiplyDecimal(corrBase, rate), decimal("100"), MONEY_SCALE);
  const corrTotal = addDecimal(corrBase, corrTax); // -11.00
  const net = addDecimal(saleTotal, corrTotal); // 99.00

  const db = await createPostgresDb(databaseUrl);
  try {
    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      resolveClient: () =>
        Promise.reject(new Error("settle-invoice-first: resolveClient must never be called")),
    });

    // 1. Issue invoice-first (deferred): the invoice is chained + filed, unpaid.
    const saleInput: RecordSaleInput = {
      tenantId: tenant,
      tillId: till,
      nodeId: node,
      seriesId: stdSeries,
      workingOrderId: brandWorkingOrderId(randomUUID()),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: saleTotal,
      lines: [
        {
          lineNo: 1,
          descriptions: { [LOCALE]: "Comida" },
          quantity: "1",
          unitPrice: saleBase,
          vatRate: rate,
          lineTotal: saleBase,
        },
      ],
      settlement: { kind: "deferred" },
      fiscalBackend: "verifactu",
      clock,
    };
    const sale = await withTenant(db, tenant, (tx) => recordSale(tx, backend, saleInput));
    console.log(
      `1. issued invoice-first sale ${sale.saleId} (total ${saleTotal}), fiscal ${sale.fiscal.recordId}`,
    );

    // 2. Outstanding: the full total.
    const before = await withTenant(db, tenant, (tx) => listOutstandingSales(tx, tenant));
    console.log(`2. outstanding: ${before.map((o) => `${o.saleId}=${o.amountDue}`).join(", ")}`);

    // 3. Correct it down by 11.00 (net 110.00 → 99.00) via a rectificativa on the rectificative series.
    const corrInput: RecordCorrectionInput = {
      tenantId: tenant,
      tillId: till,
      nodeId: node,
      seriesId: rectSeries,
      correctsSaleId: sale.saleId,
      total: corrTotal,
      lines: [
        {
          lineNo: 1,
          descriptions: { [LOCALE]: "Descuento" },
          quantity: "1",
          unitPrice: corrBase,
          vatRate: rate,
          lineTotal: corrBase,
        },
      ],
      fiscalBackend: "verifactu",
      clock,
    };
    const corr = await withTenant(db, tenant, (tx) => recordCorrection(tx, backend, corrInput));
    console.log(
      `3. issued rectificativa ${corr.saleId} (total ${corrTotal}), fiscal ${corr.fiscal.recordId}`,
    );

    // 4. Outstanding: now the net.
    const afterCorrection = await withTenant(db, tenant, (tx) => listOutstandingSales(tx, tenant));
    console.log(
      `4. outstanding: ${afterCorrection.map((o) => `${o.saleId}=${o.amountDue}`).join(", ")}`,
    );

    // 5. Settle at the net.
    await withTenant(db, tenant, (tx) =>
      settleSale(tx, {
        tenantId: tenant,
        saleId: sale.saleId,
        tenders: [{ method: "cash", amount: net, tipAmount: "0.00", settledAt: clock.now().instant }],
      }),
    );
    console.log(`5. settled ${sale.saleId} at ${net}`);

    // 6. Outstanding: empty.
    const afterSettle = await withTenant(db, tenant, (tx) => listOutstandingSales(tx, tenant));
    console.log(
      `6. outstanding: ${afterSettle.length === 0 ? "(none)" : afterSettle.map((o) => `${o.saleId}=${o.amountDue}`).join(", ")}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("settle-invoice-first: failed");
  console.error(error);
  process.exit(1);
});
