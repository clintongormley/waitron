// The break-glass verifier column on the deployment singleton: an owner-role write, app-role read.
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type Database } from "./client.js";
import { readBreakGlassVerifier, setBreakGlassVerifierTx, stampDeployment } from "./deployment.js";
import { captureError, pgErrorCode } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";

describeEachTarget("the deployment break-glass verifier", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("reads null before anything is written", async () => {
    await stampDeployment(db, "preproduction"); // creates the id=1 row, verifier still unset
    expect(await readBreakGlassVerifier(db)).toBeNull();
  });

  it("round-trips the break-glass verifier written on a caller transaction", async () => {
    await stampDeployment(db, "preproduction");
    expect(await readBreakGlassVerifier(db)).toBeNull();
    await db.transaction((tx) => setBreakGlassVerifierTx(tx, "scrypt$aa$bb"));
    expect(await readBreakGlassVerifier(db)).toBe("scrypt$aa$bb");
  });

  // Real Postgres only: PGlite connects as a superuser, so grants are never enforced there — the
  // 42501 the app role must hit on a write never fires and a pass would prove nothing (CLAUDE.md §4).
  it.runIf(target.name === "postgres")(
    "app_user may SELECT the column but an app-role UPDATE of it is refused 42501 (spec §9.3)",
    async () => {
      // Owner writes the verifier first, so there is a value for the app role to read back.
      await stampDeployment(db, "preproduction");
      await db.transaction((tx) => setBreakGlassVerifierTx(tx, "scrypt$cc$dd"));

      // As app_user: the SELECT of the new column succeeds (table-level SELECT covers it) …
      const read = await db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        return tx.execute<{ v: string | null }>(
          sql`select break_glass_verifier as v from deployment where id = 1`,
        );
      });
      expect(read.rows[0]?.v).toBe("scrypt$cc$dd");

      // … but the WRITE the owner performs above is refused for app_user: no UPDATE grant → 42501.
      const error = await captureError(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_user`);
          await tx.execute(sql`update deployment set break_glass_verifier = 'forged' where id = 1`);
        }),
      );
      expect(pgErrorCode(error)).toBe("42501");
    },
  );
});
