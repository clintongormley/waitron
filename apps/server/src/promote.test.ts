import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  stampDeployment,
  setSingletonRole,
  setDeploymentMode,
  readSingletonRole,
  type Database,
} from "@waitron/db";
import { createDeploymentHolders } from "./deployment-holders.js";
import { singletonPass } from "./singleton-pass.js";
import { DRAIN_DUTY } from "./pass.js";
import { promoteLocalSecondaryToPrimary, type PromoteDeps } from "./promote.js";

// PGlite is sufficient for the promote LOGIC (fence, idempotency, mirror-guard, the holder flip): none of
// these has an RLS / privilege / concurrency dependency, and the read/write both succeed as the PGlite
// superuser (CLAUDE.md §4 — pick the lighter target when the heavier one's justification does not apply).
// `appDb` and `ownerDb` are the same handle here; the owner-vs-app distinction is a Task 4 concern.
async function localSecondary(): Promise<{
  db: Database;
  deps: (log: PromoteDeps["log"]) => PromoteDeps;
}> {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await stampDeployment(db, "preproduction");
  await setSingletonRole(db, "secondary"); // (primary, secondary) — a local secondary
  const holders = createDeploymentHolders("primary", "secondary");
  return { db, deps: (log) => ({ appDb: db, ownerDb: db, holders, log }) };
}

const noopLog: PromoteDeps["log"] = () => {};

describe("promoteLocalSecondaryToPrimary", () => {
  it("refuses without a fence attestation and leaves state unchanged", async () => {
    const { db, deps } = await localSecondary();
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: false }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");
    expect(await readSingletonRole(db)).toBe("secondary"); // no write happened
    await db.close();
  });

  it("claims the singletons and flips the holder so the fiscal pass starts", async () => {
    const { db, deps } = await localSecondary();
    const d = deps(noopLog);

    // The SAME pass function, built once over the holder, must flip empty -> real on promotion (no restart).
    // The primary-pass stub returns a real `PassReport` — a `DutyReport[]`, not bare duty names — so the
    // wrapper is exercised at the type it actually carries (`PassReport.duties: DutyReport[]`, `pass.ts`).
    const pass = singletonPass(
      () => d.holders.singletonRole.current,
      async () => ({
        nextDueAt: null,
        duties: [{ duty: DRAIN_DUTY, ok: true, nextDueAt: null, durationMs: 0 }],
      }),
    );
    expect(await pass(new Date())).toEqual({ nextDueAt: null, duties: [] }); // secondary: empty pass

    const result = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(result).toEqual({ alreadyPrimary: false });
    expect(await readSingletonRole(db)).toBe("primary");
    expect(d.holders.singletonRole.current).toBe("primary");
    expect((await pass(new Date())).duties.map((r) => r.duty)).toContain(DRAIN_DUTY); // primary: real pass runs
    await db.close();
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps } = await localSecondary();
    const d = deps(noopLog);
    await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    const second = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(second).toEqual({ alreadyPrimary: true });
    expect(await readSingletonRole(db)).toBe("primary");
    await db.close();
  });

  it("refuses a mirror with promotion.not_a_local_secondary before any write", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, "mirror"); // (mirror, secondary)
    const holders = createDeploymentHolders("mirror", "secondary");
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(
        { appDb: db, ownerDb: db, holders, log: noopLog },
        { oldNodeNeutralised: true },
      ),
    );
    expect(isAppError(error) && error.code).toBe("promotion.not_a_local_secondary");
    expect(await readSingletonRole(db)).toBe("secondary"); // never written
    await db.close();
  });
});
