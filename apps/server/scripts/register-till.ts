// Registers one till as a Veri*Factu SIF, then exits. The step between `sql/bootstrap-tenant.sql`
// and `record-one-sale.ts`: a bootstrapped till has no `registro_sif` row, and `recordSale` refuses
// with `sif.not_registered` until it does.
//
// A shim: everything beyond reading argv lives in `src/provision-till.ts`, whose header explains
// why it is there and what it guarantees.
//
// Usage — build first, exactly like `dist/server.js`, for the reason `record-one-sale.ts`'s header
// records:
//   pnpm --filter @waitron/server build
//   DATABASE_URL=postgres://... node apps/server/dist/register-till.js \
//     <tenantId> <tillId> <idSistemaInformatico>
//
// The obligado's NIF is NOT an argument — see `provisionTill`'s own note. The connection string is
// read ONLY from `DATABASE_URL`, never accepted as an argument, so it stays out of shell history
// and process listings.
//
// Re-running this against an already-registered till is how a REIMAGED till is re-provisioned. It
// closes the previous chain either way, so do not run it to "check" anything.
import { createPostgresDb } from "@waitron/db";
import { tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import { provisionTill } from "../src/provision-till.js";

function usageError(message: string): never {
  console.error(`register-till: ${message}`);
  console.error(
    "usage: DATABASE_URL=<...> node apps/server/dist/register-till.js " +
      "<tenantId> <tillId> <idSistemaInformatico>",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    usageError(`expected 3 arguments, got ${args.length}`);
  }
  const [tenantArg, tillArg, idSistemaInformatico] = args;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    usageError("DATABASE_URL must be set in the environment");
  }

  const db = await createPostgresDb(databaseUrl);
  try {
    const sif = await provisionTill(db, {
      tenantId: brandTenantId(tenantArg),
      tillId: brandTillId(tillArg),
      idSistemaInformatico,
    });

    console.log(`sifId: ${sif.id}`);
    console.log(`numeroInstalacion: ${String(sif.numeroInstalacion)}`);
    console.log(`nif: ${sif.nif}`);
    console.log(`idSistemaInformatico: ${sif.idSistemaInformatico}`);
    console.log(`registradoEn: ${sif.registradoEn.toISOString()}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("register-till: failed");
  console.error(error);
  process.exit(1);
});
