// Records exactly one sale through the real Veri*Factu backend, then exits. It never contacts
// AEAT: the running server's drain submits the record later.
//
// The venue directory comes from `WAITRON_VENUE_DIR`, else `venue` under `WAITRON_STATE_DIR`, else
// the bundle's default state root — the same resolver the server uses (`scripts/venue-dir.ts`).
//
// Usage — build first: plain `node <file>.ts` cannot resolve this repo's `.js`-suffixed relative
// imports to their `.ts` siblings.
//   pnpm --filter @waitron/server build
//   WAITRON_ENV=production|preproduction \
//     node apps/server/dist/record-one-sale.js \
//     <tillId> <nodeId> <seriesId> <description> <baseAmount> <vatRate> [tipAmount]
//
// `WAITRON_ENV` is required here rather than defaulted: it stamps `entorno` onto an append-only
// fiscal record (CLAUDE.md §5), so a wrong default cannot be corrected afterwards.
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openVenueDatabase, withTransaction } from "@waitron/db";
import { deploymentEnvironment } from "../src/config.js";
import { resolveScriptVenueDir } from "./venue-dir.js";
import {
  addDecimal,
  decimal,
  percentOf,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";

const LOCALE = "es-ES";

function usageError(message: string): never {
  console.error(`record-one-sale: ${message}`);
  console.error(
    "usage: WAITRON_ENV=<production|preproduction> " +
      "node apps/server/dist/record-one-sale.js " +
      "<tillId> <nodeId> <seriesId> <description> <baseAmount> <vatRate> [tipAmount]",
  );
  process.exit(1);
}

/** The host's system clock, trusted as anchored: this runs once, on the box itself. */
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

/** The seven positional arguments, as the operator typed them: branded and parsed inside. */
export interface RecordOneSaleArgs {
  tillId: string;
  nodeId: string;
  seriesId: string;
  description: string;
  /** The line's tax-EXCLUSIVE amount, as a decimal literal. */
  baseAmount: string;
  /** A percentage literal — "10.00" means 10%. */
  vatRate: string;
  /** Optional; absent means "0.00". */
  tipAmount?: string;
}

export type RecordOneSaleResult = Awaited<ReturnType<typeof recordSale>>;

/** Exported so a test can run the whole path; `main` adds only the argument checks and stdout. */
export async function recordOneSale(
  args: RecordOneSaleArgs,
  env: NodeJS.ProcessEnv,
): Promise<RecordOneSaleResult> {
  const till = brandTillId(args.tillId);
  const node = brandNodeId(args.nodeId);
  const series = brandSeriesId(args.seriesId);

  const baseAmount = decimal(args.baseAmount);
  const vatRate = decimal(args.vatRate);
  const tipAmount = decimal(args.tipAmount ?? "0.00");

  // The same `percentOf` `recordSale` uses for the VAT breakdown, so `total` agrees with it.
  const tax = percentOf(baseAmount, vatRate);
  const total = addDecimal(baseAmount, tax);
  // The tip rides on the tender, not the sale: the tender covers total plus tip.
  const tenderAmount = addDecimal(total, tipAmount);

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
      // `recordSale` never contacts AEAT, so this is never called.
      resolveClient: () =>
        Promise.reject(
          new Error("record-one-sale: resolveClient must never be called by recordSale"),
        ),
    });

    const input: RecordSaleInput = {
      tillId: till,
      nodeId: node,
      seriesId: series,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total,
      lines: [
        {
          lineNo: 1,
          name: args.description,
          descriptions: { [LOCALE]: args.description },
          quantity: "1",
          unitPrice: baseAmount,
          vatRate,
          lineTotal: baseAmount,
        },
      ],
      settlement: {
        kind: "immediate",
        tenders: [
          { method: "cash", amount: tenderAmount, tipAmount, settledAt: clock.now().instant },
        ],
      },
      clock,
    };

    return await withTransaction(db, (tx) => recordSale(tx, backend, input));
  } finally {
    await store.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 6 && args.length !== 7) {
    usageError(`expected 6 or 7 arguments, got ${args.length}`);
  }
  const [tillArg, nodeArg, seriesArg, description, baseAmountArg, vatRateArg, tipArg] = args;

  const rawEnv = process.env.WAITRON_ENV;
  if (rawEnv === undefined || rawEnv === "") {
    usageError("WAITRON_ENV must be set in the environment (production or preproduction)");
  }

  const result = await recordOneSale(
    {
      tillId: tillArg,
      nodeId: nodeArg,
      seriesId: seriesArg,
      description,
      baseAmount: baseAmountArg,
      vatRate: vatRateArg,
      tipAmount: tipArg,
    },
    process.env,
  );

  console.log(`saleId: ${result.saleId}`);
  console.log(`fiscalRecordId: ${result.fiscal.recordId}`);
  console.log(`fiscalState: ${result.fiscal.state}`);
  if (result.fiscal.verificationUrl !== undefined) {
    console.log(`verificationUrl: ${result.fiscal.verificationUrl}`);
  }
}

// Only when invoked directly: an import that ran it would write an append-only fiscal record.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    console.error("record-one-sale: failed");
    console.error(error);
    process.exit(1);
  });
}
