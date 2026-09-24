/**
 * Several publishes started together leave exactly one published roster version. The venue file's
 * write queue serialises them; the mechanism is recorded on `racePair`
 * (`packages/catalogue/test/fixtures.ts`).
 *
 * Weaker than its name: serialised, the losers are refused on the ordinary re-read path, so no race
 * the guard could lose is staged. In the second case nothing collides on
 * `roster_versions_published_period_uq`, so its `roster.period_already_published` loop runs over an
 * empty list; `migrations.test.ts` exercises that index directly.
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
    // A distinct publisher per call, so the surviving `published_by` identifies the winner.
    const persons = await Promise.all(
      Array.from({ length: PUBLISHERS }, (_, i) => seedPerson(suite.db, `publisher-${i}`)),
    );
    const results = await Promise.allSettled(
      persons.map((publishedByPersonId) =>
        withTransaction(suite.db, (tx) =>
          backend.publishRoster(tx, { versionId, publishedByPersonId }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(PUBLISHERS - 1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as AppError).code).toBe("roster.already_published");
    }

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
    // Which publisher wins is not asserted: the queue's admission order is not fixed here.
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

    // Empty under one writer (see the header); kept as the shape a second writer must satisfy.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results.filter((r) => r.status === "rejected")) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as AppError).code).toBe("roster.period_already_published");
    }

    const rows = await suite.db
      .select({ status: rosterVersions.status })
      .from(rosterVersions)
      .where(eq(rosterVersions.locationId, locationId));
    expect(rows.filter((r) => r.status === "published")).toHaveLength(1);
    expect(rows).toHaveLength(PUBLISHERS);
  });
});
