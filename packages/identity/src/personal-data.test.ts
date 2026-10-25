import { createHash } from "node:crypto";
import { CORE_MIGRATIONS, deviceProfiles, locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { IDENTITY_PERSONAL_DATA } from "./personal-data.js";
import { persons } from "./schema/persons.js";
import { SECRET_HASH_PREFIX } from "./secret-hash.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { recoveryCodes } from "./schema/recovery-codes.js";
import { sessions } from "./schema/sessions.js";
import { managementSessions } from "./schema/management-sessions.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { totpEnrollments } from "./schema/totp-enrollments.js";
import { googleOidcStates } from "./schema/google-oidc-states.js";
import { deviceProfileAdmissionPersons } from "./schema/profile-admission.js";
import { codeOf } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

/** A 64-character hex value unique to `seed`, the shape the hash columns require. */
const hash64 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

/** A timestamp unique to `year` and `n`: every row in the fixture gets its own. */
const at = (year: number, n: number): string =>
  new Date(Date.UTC(year, 0, 1, 0, n, 0)).toISOString();

interface Seeded {
  readonly personId: string;
  /** Every secret written for this person; none may appear in any file. */
  readonly secrets: readonly string[];
  /** Values distinct to this person, for the "only hers" check. */
  readonly distinct: readonly string[];
}

async function seedLocation(db: Database): Promise<string> {
  const [row] = await db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return row!.id;
}

/** A person with a distinct value in every exported column, and rows in every table. */
async function seedFull(
  db: Database,
  locationId: string,
  who: string,
  year: number,
): Promise<Seeded> {
  const s = (name: string) => `${who}-${name}`;
  const t = (n: number) => at(year, n);
  const secrets = {
    pinHash: `${SECRET_HASH_PREFIX}${s("pin-salt-secret")}$${s("pin-hash-secret")}`,
    passwordHash: s("password-hash-secret"),
    totpSecret: s("totp-ciphertext-secret"),
    googleSubject: s("google-subject-secret"),
    credentialIds: [s("credential-id-one"), s("credential-id-two")],
    publicKeys: [s("public-key-one"), s("public-key-two")],
    recoveryHashes: [1, 2, 3, 4, 5].map((n) => hash64(s(`recovery-${n}`))),
    deviceTokens: [hash64(s("device-session-token")), hash64(s("device-session-token-two"))],
    dashboardTokens: [hash64(s("dashboard-token-open")), hash64(s("dashboard-token-ended"))],
    actionTokens: ["invitation", "reset", "change"].map((p) => hash64(s(`action-token-${p}`))),
    actionCodes: ["invitation", "reset", "change"].map((p) => hash64(s(`action-code-${p}`))),
    enrollmentCiphertexts: [s("enrollment-ciphertext-one"), s("enrollment-ciphertext-two")],
    challenges: [s("passkey-challenge-one"), s("passkey-challenge-two")],
    stateHashes: [hash64(s("google-state-one")), hash64(s("google-state-two"))],
    nonces: [s("google-nonce-one"), s("google-nonce-two")],
    verifiers: [s("google-verifier-one"), s("google-verifier-two")],
  };
  const [person] = await db
    .insert(persons)
    .values({
      displayName: s("Display"),
      displayNameFolded: s("display").toLowerCase(),
      firstNames: s("First"),
      lastNames: s("Last"),
      telephone: `+44 7700 ${year}`,
      pinHash: secrets.pinHash,
      passwordHash: secrets.passwordHash,
      totpSecret: secrets.totpSecret,
      locale: who === "marta" ? "es" : "en",
      passkeyOfferedAt: t(1),
      email: `${who}@example.test`,
      pendingEmail: `${who}.new@example.test`,
      emailVerifiedAt: t(2),
      googleSubject: secrets.googleSubject,
      role: who === "marta" ? "supervisor" : "manager",
      status: "active",
      createdAt: t(0),
    })
    .returning({ id: persons.id });
  const personId = person!.id;

  // Inserted later-first, so the export's ordering is what puts them in order.
  await db.insert(webauthnCredentials).values([
    {
      personId,
      credentialId: secrets.credentialIds[1]!,
      name: s("Laptop key"),
      publicKey: secrets.publicKeys[1]!,
      counter: 7,
      transports: '["usb"]',
      aaguid: null,
      createdAt: t(4),
      lastUsedAt: null,
    },
    {
      personId,
      credentialId: secrets.credentialIds[0]!,
      name: s("Phone key"),
      publicKey: secrets.publicKeys[0]!,
      counter: 3,
      transports: '["internal"]',
      aaguid:
        who === "marta"
          ? "bada5566-a7aa-401f-bd96-45619a55120d"
          : "d548826e-79b4-db40-a3d8-11116f7e8349",
      createdAt: t(3),
      lastUsedAt: t(5),
    },
  ]);

  await db.insert(recoveryCodes).values(
    secrets.recoveryHashes.map((codeHash, i) => ({
      personId,
      codeHash,
      createdAt: t(6 + i),
      usedAt: i < 2 ? t(11 + i) : null,
    })),
  );

  const { deviceId } = await seedDevice(db, {
    locationId,
    label: s("Bar tablet"),
  });
  const { deviceId: secondDeviceId } = await seedDevice(db, {
    locationId,
    label: s("Kitchen phone"),
  });
  // Later-first, as for every list below.
  await db.insert(sessions).values([
    {
      personId,
      deviceId: secondDeviceId,
      tokenHash: secrets.deviceTokens[1]!,
      openedAt: t(34),
      endedAt: null,
    },
    {
      personId,
      deviceId,
      tokenHash: secrets.deviceTokens[0]!,
      openedAt: t(13),
      endedAt: t(14),
    },
  ]);

  await db.insert(managementSessions).values([
    {
      personId,
      tokenHash: secrets.dashboardTokens[0]!,
      createdAt: t(17),
      lastSeenAt: t(18),
      endedAt: null,
    },
    {
      personId,
      tokenHash: secrets.dashboardTokens[1]!,
      createdAt: t(15),
      lastSeenAt: t(16),
      endedAt: t(19),
    },
  ]);

  await db.insert(managementAccountActions).values([
    {
      personId,
      purpose: "email_change",
      targetEmail: `${who}.changed@example.test`,
      tokenHash: secrets.actionTokens[2]!,
      codeHash: secrets.actionCodes[2]!,
      codeExpiresAt: t(28),
      codeAttempts: 3,
      createdAt: t(26),
      expiresAt: t(27),
      usedAt: null,
    },
    {
      personId,
      purpose: "invitation",
      targetEmail: null,
      tokenHash: secrets.actionTokens[0]!,
      codeHash: secrets.actionCodes[0]!,
      codeExpiresAt: t(22),
      codeAttempts: 1,
      createdAt: t(20),
      expiresAt: t(21),
      usedAt: t(23),
    },
    {
      personId,
      purpose: "password_reset",
      targetEmail: null,
      tokenHash: secrets.actionTokens[1]!,
      codeHash: secrets.actionCodes[1]!,
      codeExpiresAt: t(25),
      codeAttempts: 2,
      createdAt: t(24),
      expiresAt: t(29),
      usedAt: null,
    },
  ]);

  await db.insert(totpEnrollments).values([
    {
      personId,
      encryptedSecret: secrets.enrollmentCiphertexts[1]!,
      createdAt: t(35),
      expiresAt: t(36),
    },
    {
      personId,
      encryptedSecret: secrets.enrollmentCiphertexts[0]!,
      createdAt: t(30),
      expiresAt: t(31),
    },
  ]);
  await db.insert(webauthnChallenges).values([
    { personId, challenge: secrets.challenges[1]!, createdAt: t(37) },
    { personId, challenge: secrets.challenges[0]!, createdAt: t(32) },
  ]);
  await db.insert(googleOidcStates).values(
    [1, 0].map((i) => ({
      personId,
      mode: "link",
      stateHash: secrets.stateHashes[i]!,
      nonce: secrets.nonces[i]!,
      verifier: secrets.verifiers[i]!,
      expiresAt: i === 0 ? t(33) : t(38),
    })),
  );

  // Named so that the name order is the reverse of the insert order.
  const profileNames = [s("Zone kitchen screens"), s("Zone bar tills")];
  for (const [i, name] of profileNames.entries()) {
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name, formFactor: "till", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    await db
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profile!.id, personId, admitted: i === 0 });
  }

  return {
    personId,
    secrets: Object.values(secrets).flat(),
    distinct: [
      personId,
      s("Display"),
      s("First"),
      s("Last"),
      `+44 7700 ${year}`,
      `${who}@example.test`,
      `${who}.new@example.test`,
      `${who}.changed@example.test`,
      s("Laptop key"),
      s("Phone key"),
      s("Bar tablet"),
      s("Kitchen phone"),
      ...(who === "marta" ? [] : ["Bitwarden"]),
      ...profileNames,
      ...Array.from({ length: 39 }, (_, n) => t(n)),
    ],
  };
}

/** Rows that name nobody: a passkey sign-in challenge and a Google sign-in state. */
async function seedSignInsWithNoPerson(db: Database): Promise<string[]> {
  const challenge = "nobody-sign-in-challenge-secret";
  const stateHash = hash64("nobody-google-state");
  await db.insert(webauthnChallenges).values({ personId: null, challenge, createdAt: at(2024, 1) });
  await db.insert(googleOidcStates).values({
    personId: null,
    mode: "login",
    stateHash,
    nonce: "nobody-nonce-secret",
    verifier: "nobody-verifier-secret",
    expiresAt: at(2024, 2),
  });
  return [challenge, stateHash, "nobody-nonce-secret", "nobody-verifier-secret"];
}

const subject = (personId: string) => ({
  personId,
  language: "en" as const,
  at: new Date("2026-10-24T10:00:00.000Z"),
  timeZone: "UTC",
  locationId: null,
});

async function download(personId: string): Promise<{ name: string; text: string }[]> {
  const build = await withTransaction(suite.db, (tx) =>
    IDENTITY_PERSONAL_DATA.prepare(tx, subject(personId)),
  );
  const files = await build();
  return files.map((f) => {
    if (typeof f.content !== "string") throw new Error(`${f.name} is not text`);
    return { name: f.name, text: f.content };
  });
}

async function downloadParsed(personId: string): Promise<{ profile: unknown; signIn: unknown }> {
  const files = await download(personId);
  expect(files.map((f) => f.name)).toEqual(["profile.json", "sign-in.json"]);
  for (const f of files) expect(f.text.endsWith("}\n")).toBe(true);
  return { profile: JSON.parse(files[0]!.text), signIn: JSON.parse(files[1]!.text) };
}

async function seedBoth() {
  const locationId = await seedLocation(suite.db);
  const marta = await seedFull(suite.db, locationId, "marta", 2021);
  const colleague = await seedFull(suite.db, locationId, "colleague", 2022);
  const nobody = await seedSignInsWithNoPerson(suite.db);
  return { marta, colleague, nobody };
}

describe("IDENTITY_PERSONAL_DATA", () => {
  it("declares its two files", () => {
    expect(IDENTITY_PERSONAL_DATA.files).toEqual(["profile.json", "sign-in.json"]);
  });

  it("builds exactly the expected files, with every list in its order", async () => {
    const { marta } = await seedBoth();
    const t = (n: number) => at(2021, n);
    const expectedProfile = {
      id: marta.personId,
      displayName: "marta-Display",
      firstNames: "marta-First",
      lastNames: "marta-Last",
      email: "marta@example.test",
      pendingEmail: "marta.new@example.test",
      emailVerifiedAt: t(2),
      telephone: "+44 7700 2021",
      locale: "es",
      role: "supervisor",
      status: "active",
      createdAt: t(0),
      deviceProfileExceptions: [
        { deviceProfile: "marta-Zone bar tills", admitted: false },
        { deviceProfile: "marta-Zone kitchen screens", admitted: true },
      ],
    };
    const expectedSignIn = {
      pinSet: true,
      passwordSet: true,
      twoFactorOn: true,
      googleLinked: true,
      passkeyOfferedAt: t(1),
      passkeys: [
        { name: "marta-Phone key", provider: "1Password", createdAt: t(3), lastUsedAt: t(5) },
        { name: "marta-Laptop key", provider: null, createdAt: t(4), lastUsedAt: null },
      ],
      recoveryCodes: { unused: 3, used: 2 },
      dashboardSessions: [
        { openedAt: t(15), lastSeenAt: t(16), endedAt: t(19) },
        { openedAt: t(17), lastSeenAt: t(18), endedAt: null },
      ],
      deviceSessions: [
        { device: "marta-Bar tablet", openedAt: t(13), endedAt: t(14) },
        { device: "marta-Kitchen phone", openedAt: t(34), endedAt: null },
      ],
      accountEmails: [
        {
          purpose: "invitation",
          newEmail: null,
          createdAt: t(20),
          expiresAt: t(21),
          usedAt: t(23),
          codeExpiresAt: t(22),
          codeAttempts: 1,
        },
        {
          purpose: "password_reset",
          newEmail: null,
          createdAt: t(24),
          expiresAt: t(29),
          usedAt: null,
          codeExpiresAt: t(25),
          codeAttempts: 2,
        },
        {
          purpose: "email_change",
          newEmail: "marta.changed@example.test",
          createdAt: t(26),
          expiresAt: t(27),
          usedAt: null,
          codeExpiresAt: t(28),
          codeAttempts: 3,
        },
      ],
      unfinishedSetups: [
        { kind: "two-factor", startedAt: t(30), expiresAt: t(31) },
        { kind: "two-factor", startedAt: t(35), expiresAt: t(36) },
        { kind: "passkey", startedAt: t(32), expiresAt: null },
        { kind: "passkey", startedAt: t(37), expiresAt: null },
        { kind: "google-link", startedAt: null, expiresAt: t(33) },
        { kind: "google-link", startedAt: null, expiresAt: t(38) },
      ],
    };
    const { profile, signIn } = await downloadParsed(marta.personId);
    expect(profile).toEqual(expectedProfile);
    expect(signIn).toEqual(expectedSignIn);
    // toEqual ignores key order, which the export fixes: compare the text too.
    expect((await download(marta.personId)).map((f) => f.text)).toEqual([
      `${JSON.stringify(expectedProfile, null, 2)}\n`,
      `${JSON.stringify(expectedSignIn, null, 2)}\n`,
    ]);
  });

  it("contains no secret of anyone, while the person's own telephone is found", async () => {
    const { marta, colleague, nobody } = await seedBoth();
    const text = (await download(marta.personId)).map((f) => f.text).join("\n");
    expect(text).toContain("+44 7700 2021");
    const secrets = [...marta.secrets, ...colleague.secrets, ...nobody];
    expect(secrets.length).toBeGreaterThan(30);
    expect(secrets.filter((secret) => text.includes(secret))).toEqual([]);
  });

  it("contains nothing of a colleague's", async () => {
    const { marta, colleague } = await seedBoth();
    const text = (await download(marta.personId)).map((f) => f.text).join("\n");
    expect(text).toContain(marta.personId);
    expect(colleague.distinct.filter((value) => text.includes(value))).toEqual([]);
  });

  it("gives a person with only a display name both files, empty", async () => {
    await seedBoth();
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: "Only A Name" })
      .returning({ id: persons.id, createdAt: persons.createdAt });
    const { profile, signIn } = await downloadParsed(row!.id);
    expect(profile).toEqual({
      id: row!.id,
      displayName: "Only A Name",
      firstNames: null,
      lastNames: null,
      email: null,
      pendingEmail: null,
      emailVerifiedAt: null,
      telephone: null,
      locale: null,
      role: "staff",
      status: "active",
      createdAt: row!.createdAt,
      deviceProfileExceptions: [],
    });
    expect(signIn).toEqual({
      pinSet: false,
      passwordSet: false,
      twoFactorOn: false,
      googleLinked: false,
      passkeyOfferedAt: null,
      passkeys: [],
      recoveryCodes: { unused: 0, used: 0 },
      dashboardSessions: [],
      deviceSessions: [],
      accountEmails: [],
      unfinishedSetups: [],
    });
  });

  it("gives a suspended person the same files", async () => {
    const { marta } = await seedBoth();
    const active = await downloadParsed(marta.personId);
    await suite.db
      .update(persons)
      .set({ status: "suspended" })
      .where(eq(persons.id, marta.personId));
    const suspended = await downloadParsed(marta.personId);
    expect(suspended.profile).toEqual({
      ...(active.profile as Record<string, unknown>),
      status: "suspended",
    });
    expect(suspended.signIn).toEqual(active.signIn);
  });

  it("does not count the configuration import's placeholder as a PIN", async () => {
    await seedBoth();
    const [row] = await suite.db
      .insert(persons)
      .values({
        displayName: "Imported Person",
        pinHash: `disabled-import:${crypto.randomUUID()}`,
        status: "suspended",
      })
      .returning({ id: persons.id });
    const { signIn } = await downloadParsed(row!.id);
    expect(signIn).toMatchObject({ pinSet: false });
  });

  it("does not count a stored value no PIN can match as a PIN", async () => {
    await seedBoth();
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: "Mirror Viewer", pinHash: "mirror-viewer-never-logs-in" })
      .returning({ id: persons.id });
    const { signIn } = await downloadParsed(row!.id);
    expect(signIn).toMatchObject({ pinSet: false });
  });

  it("refuses an id with no person as person.not_found", async () => {
    expect(
      await codeOf(() =>
        withTransaction(suite.db, (tx) =>
          IDENTITY_PERSONAL_DATA.prepare(tx, subject("00000000-0000-4000-8000-000000000000")),
        ),
      ),
    ).toBe("person.not_found");
  });
});
