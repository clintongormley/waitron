/**
 * Several publishes started together leave exactly one published roster version.
 *
 * ## What this suite was, and what converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb`, one backend per publisher, and it was
 * written around two row locks: `rosterVersionStatus`'s `select … for update` on the version being
 * published, and `supersedePriorPublished`'s `for update of prior` on any incumbent. Both clauses
 * are deleted — SQLite has no row locks — and what serialises publishers now is the venue file's
 * write queue: `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside
 * `db.withWriteLock`. The mechanism, its measurement and its control in the other direction are
 * recorded once on `racePair` (`packages/catalogue/test/fixtures.ts`).
 *
 * A stale claim is retired here rather than carried: the previous header said a SQLite version
 * "cannot be written yet either — `publishRoster` itself is still red on `near "at": syntax
 * error`". That is no longer true. `shift-local-date.ts` replaced the `at time zone` expression,
 * and `scheduling.test.ts`'s eleven `publishRoster` cases pass on this engine (measured
 * 2026-09-22, `pnpm --filter @waitron/workforce test src/scheduling.test.ts`).
 *
 * **What stopped being checked:**
 *
 * 1. `runs its publishers on distinct backend processes` — deleted; `pg_backend_pid()` has no
 *    counterpart and there are no backends.
 * 2. The second case below no longer stages a race that the guard could LOSE. Under the queue the
 *    six publishes run one after another, so the five losers read a committed `published` and are
 *    refused on the ordinary re-read path — the same path `scheduling.test.ts`'s
 *    `throws roster.already_published when republishing a published version` already walks. What
 *    this case still adds over that one is the end state after six callers fire at once: one
 *    winner, five refusals, and the winner's own `published_by_person_id` on the row.
 * 3. In the third case the `roster.period_already_published` branch is now UNREACHABLE, and the
 *    assertion over it is vacuous — it loops over an empty list. Measured, not inferred: replacing
 *    that case's first assertion with `expect(results.map((r) => r.status)).toEqual(["PROBE"])`
 *    printed six `"fulfilled"` and no rejection (2026-09-22, Node v26.7.0). Serialised, each publisher
 *    supersedes the incumbent and commits, so nothing ever collides on
 *    `roster_versions_published_period_uq`. That index is untouched and is still what would refuse
 *    a collision; nothing here reaches it. `migrations.test.ts`'s
 *    `rejects a second published version for the same (location, period) via the partial unique
 *    index` is what exercises the index directly. The invariant this case still asserts — exactly
 *    ONE published row survives the six — is the one that matters and it is not vacuous.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WorkforceBackend } from "./clocking.js";
import { rosterVersions } from "./schema/roster-versions.js";
import { insertRosterVersion, seedLocation, seedPerson } from "../test/fixtures.js";

const PUBLISHERS = 6;

const backend = new WorkforceBackend();
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

let locationId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
});

describe("publishRoster under concurrent publishers", () => {
  it("lets exactly one concurrent publish of a draft win; the rest see roster.already_published", async () => {
    const versionId = await insertRosterVersion(suite.db, { locationId });
    // A distinct publisher person per call, so the surviving `published_by` identifies the ONE
    // winner and proves no refused publisher overwrote it.
    const persons = await Promise.all(
      Array.from({ length: PUBLISHERS }, (_, i) => seedPerson(suite.db, `publisher-${i}`)),
    );
    // Started without awaiting each other; nothing but the write queue keeps them apart.
    const results = await Promise.allSettled(
      persons.map((publishedByPersonId) =>
        withTransaction(suite.db, (tx) =>
          backend.publishRoster(tx, { versionId, publishedByPersonId }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(PUBLISHERS - 1);
    // Every refusal is the publish-once guard firing, not some unrelated failure.
    for (const r of results.filter((r) => r.status === "rejected")) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as AppError).code).toBe("roster.already_published");
    }

    // The committed row carries the winner's stamp — published exactly once, and no refused
    // publisher's person_id leaked in over it.
    const winnerIndex = results.findIndex((r) => r.status === "fulfilled");
    const [row] = await suite.db
      .select({
        status: rosterVersions.status,
        publishedByPersonId: rosterVersions.publishedByPersonId,
        publishedAt: rosterVersions.publishedAt,
      })
      .from(rosterVersions)
      .where(eq(rosterVersions.id, versionId));
    expect(row?.status).toBe("published");
    expect(row?.publishedByPersonId).toBe(persons[winnerIndex]!);
    expect(row?.publishedAt).not.toBeNull();
  });

  it("leaves exactly one published version when many DIFFERENT drafts for one period race to publish", async () => {
    // The supersede-on-republish invariant with every publisher started at once. Six DISTINCT
    // drafts for the SAME (location, period): each publish supersedes whatever incumbent it finds
    // committed, so exactly one `published` row survives and the other five end `superseded`.
    //
    // Which publisher wins is not asserted, and deliberately so: the winner is whichever the queue
    // admits LAST, which is an ordering this suite does not fix.
    const period = { periodStart: "2026-06-01", periodEnd: "2026-06-07" };
    const versions = await Promise.all(
      Array.from({ length: PUBLISHERS }, () =>
        insertRosterVersion(suite.db, { locationId, ...period }),
      ),
    );
    const results = await Promise.allSettled(
      versions.map((versionId) =>
        withTransaction(suite.db, (tx) => backend.publishRoster(tx, { versionId })),
      ),
    );

    // At least one publisher must succeed, and any failure must be the index backstop translated —
    // not some unrelated error. See the header: under one writer this list is empty, so the loop
    // below asserts nothing today and is kept as the shape a second writer would have to satisfy.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results.filter((r) => r.status === "rejected")) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as AppError).code).toBe("roster.period_already_published");
    }

    // THE invariant: exactly one published row survives for the period, and the rest are superseded
    // or still draft — never a second published.
    const rows = await suite.db
      .select({ status: rosterVersions.status })
      .from(rosterVersions)
      .where(eq(rosterVersions.locationId, locationId));
    expect(rows.filter((r) => r.status === "published")).toHaveLength(1);
    expect(rows).toHaveLength(PUBLISHERS);
  });
});
