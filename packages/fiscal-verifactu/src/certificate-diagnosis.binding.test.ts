import { putCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import {
  installed,
  candidate,
  material,
  NOW,
  INSTALLED_AT,
  parentFixture,
  revision,
  rawState,
} from "../test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A } from "../test/fixtures.js";
import { diagnoseCertificate } from "./certificate-diagnosis.js";
import { latestInstall, recordInstall } from "./certificate-record.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

describe("certificate evidence association", () => {
  it.each(["no-install", "other-node", "other-fingerprint", "other-kind", "verified"] as const)(
    "does not borrow current installation facts from %s",
    async (association) => {
      const f = await parentFixture(suite.db, false);
      await withTransaction(suite.db, async (tx) => {
        await putCredential(tx, f.deps.ring, { purpose: "fiscal.aeat", value: material() });
        if (association !== "no-install")
          await recordInstall(tx, {
            nodeId: association === "other-node" ? TENANT_A.nodeId2 : TENANT_A.nodeId,
            installedAt: new Date(INSTALLED_AT),
            source: "setup",
            personId: null,
            kind: association === "other-kind" ? "representante" : "sello",
            fingerprint:
              association === "other-fingerprint" ? candidate.fingerprint : installed.fingerprint,
            validFrom: new Date("2026-01-01T00:00:00Z"),
            validUntil: new Date("2027-01-01T00:00:00Z"),
          });
      });
      const result = await diagnoseCertificate(
        f.deps,
        { ...f.request, expectedRevision: await revision(suite.db) },
        NOW,
      );
      expect(result).toMatchObject({
        category: "local-ready",
        kind: "sello",
        association: association === "verified" ? "verified" : "unverified",
      });
      expect(result.saved).toEqual(
        association === "no-install" || association === "other-node"
          ? null
          : {
              kind: association === "other-kind" ? "representante" : "sello",
              installedAt: INSTALLED_AT,
            },
      );
    },
  );

  it.each(["replace", "reseal-same", "new-install"] as const)(
    "rejects %s during child work with no evidence or error params",
    async (change) => {
      const f = await parentFixture(suite.db);
      let expected: Awaited<ReturnType<typeof rawState>>;
      const runChild: typeof f.deps.runChild = async (input, signal) => {
        const output = await f.deps.runChild(input, signal);
        await withTransaction(suite.db, async (tx) => {
          if (change !== "new-install")
            await putCredential(tx, f.deps.ring, {
              purpose: "fiscal.aeat",
              value: material(change === "replace" ? candidate : installed),
            });
          else {
            const latest = (await latestInstall(tx, TENANT_A.nodeId))!;
            await recordInstall(tx, {
              ...latest,
              id: "a0000000-0000-4000-8000-000000000777",
              installedAt: new Date(NOW),
            });
          }
        });
        expected = await rawState(suite.db);
        return output;
      };
      await expect(
        diagnoseCertificate({ ...f.deps, runChild }, f.request, NOW),
      ).rejects.toMatchObject({ code: "fiscal.certificate_changed", params: {} });
      expect(await rawState(suite.db)).toEqual(expected!);
    },
  );

  it("rejects replacement before start without running native work", async () => {
    const f = await parentFixture(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, f.deps.ring, {
        purpose: "fiscal.aeat",
        value: material(candidate, "representante"),
      }),
    );
    let dispatched = false;
    await expect(
      diagnoseCertificate(
        {
          ...f.deps,
          runChild: async () => {
            dispatched = true;
            throw new Error("must not dispatch");
          },
        },
        f.request,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "fiscal.certificate_changed", params: {} });
    expect(dispatched).toBe(false);
  });
});
