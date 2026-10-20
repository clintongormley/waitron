import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import {
  IDENTITY_BACKUP_VERIFICATION,
  IDENTITY_MIGRATIONS,
  beginOwnTotpEnrollment,
  hashPassword,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { openBackupQuery } from "@waitron/store";
import { accountPurposeKey, resolveAccountKey } from "./account-key.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

describe("archived operational TOTP derivation", () => {
  it.each(["derived", "explicit", "empty"])(
    "checks an enrolment made through the server account-key path: %s",
    async (mode) => {
      const env: Record<string, string> = {
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "7",
        ...(mode === "derived"
          ? {}
          : {
              WAITRON_ACCOUNT_KEY: mode === "empty" ? "" : Buffer.alloc(32, 8).toString("base64"),
            }),
      };
      const accountKey = resolveAccountKey(env, loadKeyRing(env));
      const ring = { current: { version: 1, key: accountPurposeKey(accountKey, "totp") } };
      const [person] = await suite.db
        .insert(persons)
        .values({
          displayName: "Manager",
          email: "manager@example.test",
          passwordHash: hashPassword("correct horse"),
          role: "manager",
        })
        .returning();
      const session = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { personId: person!.id }),
      );
      await withTransaction(suite.db, (tx) =>
        beginOwnTotpEnrollment(tx, {
          managementSessionId: session.token,
          currentPassword: "correct horse",
          keyRing: ring,
        }),
      );
      const [enrolment] = suite.db.all<{ encrypted_secret: string }>(
        sql`select encrypted_secret from totp_enrollments`,
      );
      await suite.db
        .update(persons)
        .set({ totpSecret: enrolment!.encrypted_secret })
        .where(eq(persons.id, person!.id));
      const path = suite.db
        .all<{ file: string }>(sql`pragma database_list`)
        .find((row) => row.file.endsWith("venue.db"))!.file;
      const handle = await openBackupQuery(path);
      const snapshot = suite.db.all(sql`select * from persons`);
      try {
        const result = IDENTITY_BACKUP_VERIFICATION.verifyRestoredData({
          before: handle.query,
          after: handle.query,
          entries: {
            async read(name) {
              if (name === "secrets/secrets.env")
                return Buffer.from(
                  Object.entries(env)
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n"),
                );
              return name === "secrets/trading.env" ? Buffer.from("") : null;
            },
          },
          source: {
            nodeId: "source",
            locationId: "venue",
            environment: "preproduction",
            createdAt: new Date().toISOString(),
          },
          sourceSchema: 1,
          targetSchema: 1,
          signal: new AbortController().signal,
        });
        await expect(result).resolves.toEqual({
          status: "passed",
          checks: [
            { code: "data", status: "passed" },
            { code: "secret", status: "passed" },
          ],
        });
        expect(suite.db.all(sql`select * from persons`)).toEqual(snapshot);
        expect(suite.db.all(sql`select count(*) as n from totp_enrollments`)).toEqual([{ n: 1 }]);
      } finally {
        await handle.close();
      }
    },
  );
});
