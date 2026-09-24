// Walks the invoice-first + correction + settle loop end to end, then exits. Issues an invoice-first
// (deferred) sale, prints it as outstanding, corrects it with a rectificativa, prints the reduced
// amount outstanding, settles at the net, prints an empty outstanding list. There is no till app yet
// — this is the only way to see the deferred/settle path run against the real backend.
//
// Prerequisites, same as record-one-sale.ts plus a rectificative series: the taxpayer row, the till,
// the node, the standard series and the rectificative series must already exist, and the node's SIF
// be registered.
//
// The venue is a DIRECTORY of two SQLite files, not a connection string, and which directory is not
// an argument — see `record-one-sale.ts`'s header and `scripts/venue-dir.ts`. `WAITRON_ENV` is
// REQUIRED for the reason that header gives: it stamps the unrecoverable `entorno` onto the chain.
//
// Usage — build first (this repo's .js-suffixed relative imports resolve through esbuild's bundler,
// not plain `node <file>.ts`):
//   pnpm --filter @waitron/server build
//   WAITRON_ENV=production|preproduction \
//     node apps/server/dist/settle-invoice-first.js \
//     <tillId> <nodeId> <standardSeriesId> <rectificativeSeriesId>
import { listOutstandingSales, recordCorrection, recordSale, settleSale } from "@waitron/core";
import type { OutstandingSale, RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openVenueDatabase, withTransaction } from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { deploymentEnvironment } from "../src/config.js";
import { resolveScriptVenueDir } from "./venue-dir.js";
import {
  addDecimal,
  decimal,
  negateDecimal,
  percentOf,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

const LOCALE = "es-ES";

function usageError(message: string): never {
  console.error(`settle-invoice-first: ${message}`);
  console.error(
    "usage: WAITRON_ENV=<production|preproduction> " +
      "node apps/server/dist/settle-invoice-first.js " +
      "<tillId> <nodeId> <standardSeriesId> <rectificativeSeriesId>",
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

/** The four positional arguments, as the operator typed them: branded inside. */
export interface SettleInvoiceFirstArgs {
  tillId: string;
  nodeId: string;
  standardSeriesId: string;
  rectificativeSeriesId: string;
}

/**
 * Open the venue directory `env` names, walk the whole invoice-first loop against it, and close
 * both files. Exported so a test can run it — the argv shim below adds nothing but the arity check,
 * the `WAITRON_ENV` guard and stdout.
 *
 * Every step reports through `log` rather than `console.log`, so a caller can read the narration
 * back: the six lines ARE the thing this script produces, and a test that could not see them would
 * only be asserting that nothing threw (CLAUDE.md §4).
 */
export async function settleInvoiceFirst(
  args: SettleInvoiceFirstArgs,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): Promise<void> {
  const till = brandTillId(args.tillId);
  const node = brandNodeId(args.nodeId);
  const stdSeries = brandSeriesId(args.standardSeriesId);
  const rectSeries = brandSeriesId(args.rectificativeSeriesId);

  const formatOutstanding = (list: OutstandingSale[]): string =>
    list.length === 0 ? "(none)" : list.map((o) => `${o.saleId}=${o.amountDue}`).join(", ");

  const rate = decimal("10.00");
  const vatOn = (base: Decimal): Decimal => percentOf(base, rate);

  const saleBase = decimal("100.00");
  const saleTax = vatOn(saleBase);
  const saleTotal = addDecimal(saleBase, saleTax); // 110.00

  const reduceBase = decimal("10.00");
  const corrBase = negateDecimal(reduceBase); // -10.00
  const corrTax = vatOn(corrBase);
  const corrTotal = addDecimal(corrBase, corrTax); // -11.00
  const net = addDecimal(saleTotal, corrTotal); // 99.00

  // No lock: the sale is written for a running server's drain to send.
  const store = await openVenueDatabase(await resolveScriptVenueDir(env), { exclusive: false });
  const db = store.venue;
  try {
    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db,
      environment: deploymentEnvironment(env),
      deploymentEnvironment: deploymentEnvironment(env),
      resolveClient: () =>
        Promise.reject(new Error("settle-invoice-first: resolveClient must never be called")),
    });

    // 1. Issue invoice-first (deferred): the invoice is chained + filed, unpaid.
    const saleInput: RecordSaleInput = {
      tillId: till,
      nodeId: node,
      seriesId: stdSeries,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: saleTotal,
      lines: [
        {
          lineNo: 1,
          name: "Comida",
          descriptions: { [LOCALE]: "Comida" },
          quantity: "1",
          unitPrice: saleBase,
          vatRate: rate,
          lineTotal: saleBase,
        },
      ],
      settlement: { kind: "deferred" },
      clock,
    };
    const sale = await withTransaction(db, (tx) => recordSale(tx, backend, saleInput));
    log(
      `1. issued invoice-first sale ${sale.saleId} (total ${saleTotal}), fiscal ${sale.fiscal.recordId}`,
    );

    // 2. Outstanding: the full total.
    const before = await withTransaction(db, (tx) => listOutstandingSales(tx));
    log(`2. outstanding: ${formatOutstanding(before)}`);

    // Seed a supervisor (holds `sale.rectify`) and open a shift session — the authorizer
    // recordCorrection's gate now requires (Task 10). Task 13's venue-seed comes later, so this
    // runbook creates its own. Written as its own transaction so the session is committed and
    // visible to the correction's own transaction below.
    const authorizerSession = await withTransaction(db, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({
          displayName: "Supervisora",
          email: "supervisor@invoice-first.demo",
          pinHash: hashPin("1234"),
          role: "supervisor",
        })
        .returning({ id: persons.id });
      return loginWithPin(tx, {
        tillId: till,
        personId: person!.id,
        pin: "1234",
      });
    });

    // 3. Correct it down by 11.00 (net 110.00 → 99.00) via a rectificativa on the rectificative series.
    const corrInput: RecordCorrectionInput = {
      tillId: till,
      nodeId: node,
      seriesId: rectSeries,
      correctsSaleId: sale.saleId,
      total: corrTotal,
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [LOCALE]: "Descuento" },
          quantity: "1",
          unitPrice: corrBase,
          vatRate: rate,
          lineTotal: corrBase,
        },
      ],
      clock,
      authz: { sessionId: authorizerSession.id },
    };
    const corr = await withTransaction(db, (tx) => recordCorrection(tx, backend, corrInput));
    log(
      `3. issued rectificativa ${corr.saleId} (total ${corrTotal}), fiscal ${corr.fiscal.recordId}`,
    );

    // 4. Outstanding: now the net.
    const afterCorrection = await withTransaction(db, (tx) => listOutstandingSales(tx));
    log(`4. outstanding: ${formatOutstanding(afterCorrection)}`);

    // 5. Settle at the net.
    await withTransaction(db, (tx) =>
      settleSale(tx, {
        saleId: sale.saleId,
        tenders: [
          { method: "cash", amount: net, tipAmount: "0.00", settledAt: clock.now().instant },
        ],
      }),
    );
    log(`5. settled ${sale.saleId} at ${net}`);

    // 6. Outstanding: empty.
    const afterSettle = await withTransaction(db, (tx) => listOutstandingSales(tx));
    log(`6. outstanding: ${formatOutstanding(afterSettle)}`);
  } finally {
    // Two open SQLite files; leaking them keeps the process alive after `main` returns.
    await store.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 4) {
    usageError(`expected 4 arguments, got ${args.length}`);
  }
  const [tillArg, nodeArg, stdSeriesArg, rectSeriesArg] = args;

  const rawEnv = process.env.WAITRON_ENV;
  if (rawEnv === undefined || rawEnv === "") {
    usageError("WAITRON_ENV must be set in the environment (production or preproduction)");
  }

  await settleInvoiceFirst(
    {
      tillId: tillArg,
      nodeId: nodeArg,
      standardSeriesId: stdSeriesArg,
      rectificativeSeriesId: rectSeriesArg,
    },
    process.env,
    (line) => void console.log(line),
  );
}

// Run only when invoked directly, never when imported by a test — `settleInvoiceFirst` above
// writes append-only fiscal records and consumes two invoice numbers (CLAUDE.md §5), so an import
// that ran it would be destructive and unrepairable.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    console.error("settle-invoice-first: failed");
    console.error(error);
    process.exit(1);
  });
}
