// Runs every module's per-node provisioning seed for one existing NODE, then exits — for the fiscal
// module that means registering the node as a Veri*Factu SIF (the SIF is the compute node, not the
// till). `waitron-provision venue` seeds a fresh venue's first node as it stands the venue up, so
// this script is the STANDALONE path: a node with no fiscal identity — against which `recordSale`
// refuses with `sif.not_registered` — or a reimaged node getting a fresh chain (see the note below).
//
// A shim: everything beyond reading argv lives in `src/provision-till.ts`, whose header explains
// why it is there and what it guarantees.
//
// Usage — build first, exactly like `dist/server.js`, for the reason `record-one-sale.ts`'s header
// records:
//   pnpm --filter @waitron/server build
//   DATABASE_URL=postgres://... node apps/server/dist/register-till.js <tenantId> <nodeId>
//
// The connection string is read ONLY from `DATABASE_URL`, never accepted as an argument, so it stays
// out of shell history and process listings.
//
// Re-running this against an already-registered node is how a REIMAGED node is re-provisioned. It
// closes the previous chain either way, so do not run it to "check" anything.
import { createPostgresDb } from "@waitron/db";
import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
import { ALL_MODULES } from "../src/modules.js";
import { provisionNode } from "../src/provision-till.js";

function usageError(message: string): never {
  console.error(`register-till: ${message}`);
  console.error(
    "usage: DATABASE_URL=<...> node apps/server/dist/register-till.js <tenantId> <nodeId>",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    usageError(`expected 2 arguments, got ${args.length}`);
  }
  const [tenantArg, nodeArg] = args;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    usageError("DATABASE_URL must be set in the environment");
  }

  const db = await createPostgresDb(databaseUrl);
  try {
    const seeded = await provisionNode(
      db,
      { tenantId: brandTenantId(tenantArg), nodeId: brandNodeId(nodeArg) },
      ALL_MODULES,
    );

    for (const s of seeded) console.log(`${s.module}: ${s.report}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("register-till: failed");
  console.error(error);
  process.exit(1);
});
