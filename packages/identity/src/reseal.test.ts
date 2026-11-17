import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openText, sealText } from "@waitron/credentials";
import { seedPerson } from "../test/fixtures.js";
import { insertSignInChallenge } from "./sign-in-challenges.js";
import * as identity from "./index.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const old = { current: { version: 1, key: Buffer.alloc(32, 81) } };
const ring = { current: { version: 2, key: Buffer.alloc(32, 82) }, previous: old.current };
it("re-seals two-step secrets and pending setups onto the current key", async () => {
  const personId = await seedPerson(suite.db);
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(
      sql`update persons set totp_secret=${sealText(old, "totp", "JBSWY3DPEHPK3PXP")} where id=${personId}`,
    );
    await insertSignInChallenge(tx, {
      kind: "totp_enrolment",
      personId,
      encryptedSecret: sealText(old, "totp", "KRSXG5A"),
      lifetimeMs: 600000,
      now: new Date(),
    });
  });
  expect(await identity.resealTwoStepSecrets(suite.db, ring)).toEqual({
    rotated: 2,
    alreadyCurrent: 0,
    unopened: 0,
  });
  const person = suite.db.get<{ totp_secret: string }>(
    sql`select totp_secret from persons where id=${personId}`,
  )!;
  const pending = suite.db.get<{ encrypted_secret: string }>(
    sql`select encrypted_secret from sign_in_challenges where person_id=${personId}`,
  )!;
  expect(openText({ current: ring.current }, "totp", person.totp_secret)).toEqual({
    value: "JBSWY3DPEHPK3PXP",
    keyVersion: 2,
  });
  expect(openText({ current: ring.current }, "totp", pending.encrypted_secret)).toEqual({
    value: "KRSXG5A",
    keyVersion: 2,
  });
  expect(await identity.resealTwoStepSecrets(suite.db, ring)).toEqual({
    rotated: 0,
    alreadyCurrent: 2,
    unopened: 0,
  });
  expect(suite.db.get(sql`select totp_secret from persons where id=${personId}`)).toEqual(person);
});
it("counts a secret it cannot open and goes on", async () => {
  const broken = await seedPerson(suite.db),
    sound = await seedPerson(suite.db);
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`update persons set totp_secret='unreadable' where id=${broken}`);
    await tx.execute(
      sql`update persons set totp_secret=${sealText(old, "totp", "JBSWY3DPEHPK3PXP")} where id=${sound}`,
    );
  });
  expect(await identity.resealTwoStepSecrets(suite.db, ring)).toEqual({
    rotated: 1,
    alreadyCurrent: 0,
    unopened: 1,
  });
  expect(suite.db.get(sql`select totp_secret from persons where id=${broken}`)).toEqual({
    totp_secret: "unreadable",
  });
  const stored = suite.db.get<{ totp_secret: string }>(
    sql`select totp_secret from persons where id=${sound}`,
  )!;
  expect(openText({ current: ring.current }, "totp", stored.totp_secret)?.value).toBe(
    "JBSWY3DPEHPK3PXP",
  );
});
