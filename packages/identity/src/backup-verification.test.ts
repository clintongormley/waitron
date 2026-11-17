import { seedPersons } from "../test/person-rows.js";
import {
  seedBusinessDay,
  seedDeviceProfiles,
  seedVenueSettings,
} from "@waitron/db/testing/seed.js";
import crypto, { generateKeyPairSync } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_CLASSIFICATION, CORE_MIGRATIONS, devices } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import {
  validateBackupModuleResult,
  validateBackupVerificationContribution,
} from "@waitron/module";
import { IDENTITY_BACKUP_VERIFICATION } from "./index.js";
import { IDENTITY_TABLES } from "./classification.js";
import { openText, sealText } from "@waitron/credentials";
import { hashSecret } from "./secret-hash.js";
import * as schema from "@waitron/db/schema/identity.js";

/** This module's share of core's classification, which holds its tables. */
const IDENTITY_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (IDENTITY_TABLES as readonly string[]).includes(table),
);

const original = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const restored = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const withoutIdentity = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const person = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const device = "10000000-0000-4000-8000-000000000003";
const profile = "10000000-0000-4000-8000-000000000005";
const now = "2026-10-20T08:00:00.000Z";
const old = "2026-10-01T08:00:00.000Z";
const end = "2026-10-20T09:00:00.000Z";
const vault = Buffer.alloc(32, 2);
const ring = { current: { version: 7, key: vault } };
const secret = "JBSWY3DPEHPK3PXP";
const encrypted = sealText(ring, "totp", secret);
const pending = sealText(ring, "totp", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
const password = hashSecret("correct horse");
const pin = hashSecret("1234");
const env = `WAITRON_CREDENTIALS_KEY=${vault.toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=7\n`;
const jwk = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });
const publicKey = Buffer.from(
  isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, Buffer.from(jwk.x!, "base64url")],
    ]),
  ),
).toString("base64url");
const digest = "a".repeat(64);
const entries = () => ({ "secrets/secrets.env": env, "secrets/trading.env": "" });
const passed = {
  status: "passed",
  checks: [
    { code: "data", status: "passed" },
    { code: "secret", status: "passed" },
  ],
};

beforeEach(async () => {
  for (const suite of [original, restored]) {
    if (suite === restored)
      await suite.db.insert(schema.roles).values(await original.db.select().from(schema.roles));
    await seedVenueSettings(suite.db, {
      name: "Main",
      invoiceLocales: ["en"],
    });
    await seedBusinessDay(suite.db, {});
    await seedDeviceProfiles(suite.db, {
      id: profile,
      admitted: [],
      name: "Till",
      formFactor: "till",
      capabilities: [],
    });
    await seedDeviceProfiles(suite.db, {
      id: "other-profile",
      name: "Other till",
      formFactor: "till",
      capabilities: [],
      admitted: [],
    });
    await suite.db.insert(devices).values({
      id: device,
      deviceProfileId: profile,
      label: "Till",
      tokenHash: "fixture",
      enrolledAt: now,
      createdAt: now,
    });
    await seedPersons(suite.db, [
      {
        id: person,
        jobRoles: [],
        displayName: "First",
        passwordHash: password,
        pinHash: pin,
        totpSecret: encrypted,
        createdAt: old,
      },
      {
        id: second,
        displayName: "Second",
        role: "manager",
        status: "suspended",
        createdAt: now,
        jobRoles: [],
      },
    ]);
    suite.db.run(
      sql`insert into staff_roles (id, name, colour, position) values ('job', 'Cook', 'blue', 2)`,
    );
    suite.db.run(
      sql`insert into person_staff_roles (person_id, staff_role_id) values (${person}, 'job')`,
    );
    await suite.db.insert(schema.signInChallenges).values({
      id: person,
      personId: second,
      kind: "totp_enrolment",
      encryptedSecret: pending,
      expiresAt: end,
      createdAt: old,
    });
    await suite.db.insert(schema.tillSessions).values({
      id: person,
      personId: person,
      deviceId: device,
      tokenHash: digest,
      openedAt: old,
      endedAt: now,
    });
    await suite.db
      .insert(schema.dashboardSessions)
      .values({ id: person, personId: person, tokenHash: digest, createdAt: old, lastSeenAt: now });
    await suite.db
      .insert(schema.recoveryCodes)
      .values({ id: person, personId: person, codeHash: digest, createdAt: old, usedAt: now });
    await suite.db.insert(schema.accountActions).values({
      id: person,
      personId: person,
      purpose: "password_reset",
      tokenHash: digest,
      codeHash: digest,
      codeExpiresAt: end,
      codeAttempts: 2,
      createdAt: old,
      expiresAt: end,
    });
    await suite.db.insert(schema.webauthnCredentials).values({
      id: person,
      personId: person,
      credentialId: "AQID",
      publicKey,
      counter: 42,
      transports: '["usb","internal"]',
      createdAt: old,
      lastUsedAt: now,
    });
    await suite.db.insert(schema.signInChallenges).values({
      id: `${person}-passkey`,
      personId: null,
      challenge: "AQID",
      createdAt: old,
      expiresAt: end,
      kind: "passkey_login",
    });
    await suite.db.insert(schema.signInChallenges).values({
      id: `${person}-google`,
      personId: null,
      kind: "google_login",
      createdAt: old,
      stateHash: digest,
      nonce: Buffer.alloc(32, 3).toString("base64url"),
      verifier: Buffer.alloc(48, 4).toString("base64url"),
      expiresAt: end,
    });
    await suite.db
      .insert(schema.deviceProfileAdmissionRoles)
      .values({ deviceProfileId: profile, staffRoleId: "job" });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function run(files: Record<string, string> = entries(), missingBefore = false) {
  const path = (suite: typeof original) =>
    suite.db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
  const before = await openBackupQuery(path(missingBefore ? withoutIdentity : original));
  try {
    const after = await openBackupQuery(path(restored));
    try {
      return await IDENTITY_BACKUP_VERIFICATION.verifyRestoredData({
        before: before.query,
        after: after.query,
        entries: {
          async read(name) {
            return files[name] === undefined ? null : Buffer.from(files[name]);
          },
        },
        source: {
          nodeId: "node-one",
          environment: "preproduction",
          createdAt: now,
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
function damage(statement: string, side: "before" | "after" | "both" = "both") {
  for (const suite of side === "before"
    ? [original]
    : side === "after"
      ? [restored]
      : [original, restored])
    suite.db.run(sql.raw(statement));
}
function tamper(stored: string): string {
  const parts = stored.split(".");
  const ciphertext = Buffer.from(parts[4]!, "base64url");
  ciphertext[ciphertext.length - 1]! ^= 0x01;
  return [...parts.slice(0, 4), ciphertext.toString("base64url")].join(".");
}
function verdict(data: string, secretStatus: string) {
  return {
    status:
      secretStatus === "unsupported" || data === "unsupported"
        ? "unsupported"
        : data === "invalid" || secretStatus === "invalid"
          ? "invalid"
          : "passed",
    checks: [
      { code: "data", status: data },
      { code: "secret", status: secretStatus },
    ],
  };
}

describe("identity offline backup owner", () => {
  it("authenticates every person and pending-enrolment TOTP value under the vault ring", async () => {
    const owner = validateBackupVerificationContribution(IDENTITY_BACKUP_VERIFICATION);
    expect(validateBackupModuleResult(await run(), owner, false)).toEqual(passed);
    expect([...owner.data.tables].sort()).toEqual(
      IDENTITY_CLASSIFICATION.map((c) => c.table).sort(),
    );
    expect(owner.entries).toEqual([
      { name: "secrets/secrets.env", presence: "required" },
      { name: "secrets/trading.env", presence: "required" },
      { name: "secrets/backup.env", presence: "optional" },
    ]);
  });
  it("tampers a stored TOTP value even when its ciphertext ends in a zero byte", async () => {
    let zeroEnding: string | undefined;
    for (let attempt = 0; attempt < 100_000 && zeroEnding === undefined; attempt++) {
      const candidate = sealText(ring, "totp", secret);
      if (Buffer.from(candidate.split(".")[4]!, "base64url").at(-1) === 0) zeroEnding = candidate;
    }
    if (zeroEnding === undefined) throw new Error("no ciphertext ending in a zero byte appeared");
    expect(zeroEnding.slice(0, -2) + "AA").toBe(zeroEnding);
    const tampered = tamper(zeroEnding);
    expect(tampered).not.toBe(zeroEnding);
    expect(openText(ring, "totp", zeroEnding)).toEqual({ value: secret, keyVersion: 7 });
    expect(openText(ring, "totp", tampered)).toBeNull();
    damage(`update persons set totp_secret='${tampered}' where id='${person}'`);
    await expect(run()).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it.each(["before", "after", "both"] as const)(
    "authenticates an older person ciphertext in %s",
    async (side) => {
      damage(
        "update persons set totp_secret='" + tamper(encrypted) + "' where id='" + person + "'",
        side,
      );
      await expect(run()).rejects.toMatchObject({
        name: "BackupCheckUnavailable",
        reason: "decryption_unavailable",
        message: "Backup check unavailable",
      });
    },
  );
  it.each(["before", "after", "both"] as const)(
    "authenticates pending enrolment ciphertext in %s",
    async (side) => {
      damage(
        "update sign_in_challenges set encrypted_secret='" +
          tamper(pending) +
          "' where kind='totp_enrolment'",
        side,
      );
      await expect(run()).rejects.toMatchObject({ reason: "decryption_unavailable" });
    },
  );
  it.each(["persons", "sign_in_challenges"])(
    "an unavailable stored TOTP key stays inconclusive: %s",
    async (table) => {
      const column = table === "persons" ? "totp_secret" : "encrypted_secret";
      const value = sealText({ current: { version: 8, key: vault } }, "totp", secret);
      damage(
        `update ${table} set ${column}='${value}'${table === "sign_in_challenges" ? " where kind='totp_enrolment'" : ""}`,
      );
      await expect(run()).rejects.toMatchObject({ reason: "decryption_unavailable" });
    },
  );
  it.each(["", "-7", "7e0", "07"])(
    "marks a malformed stored version invalid: %s",
    async (version) => {
      const parts = encrypted.split(".");
      parts[1] = version;
      damage(`update persons set totp_secret='${parts.join(".")}'`);
      expect(await run()).toEqual(verdict("passed", "invalid"));
    },
  );

  it.each(["v1.1.a.b.c", "v3.x.a.b.c"])(
    "unknown encrypted TOTP format stays unsupported: %s",
    async (value) => {
      damage(`update persons set totp_secret='${value}'`);
      expect(await run()).toEqual(verdict("passed", "unsupported"));
    },
  );
  it.each(["v2.7.a.b", "v2.7.AA.AA.AA"])(
    "malformed known ciphertext is invalid: %s",
    async (value) => {
      damage(
        `update sign_in_challenges set encrypted_secret='${value}' where kind='totp_enrolment'`,
      );
      expect(await run()).toEqual(verdict("passed", "invalid"));
    },
  );
  it.each(["", "not a base32 secret!"])(
    "authenticated malformed plaintext is invalid: %s",
    async (value) => {
      const encryptedBad = sealText(ring, "totp", value);
      damage(
        `update sign_in_challenges set encrypted_secret='${encryptedBad}' where kind='totp_enrolment'`,
      );
      expect(await run()).toEqual(verdict("passed", "invalid"));
    },
  );
  it.each(["secrets/secrets.env", "secrets/trading.env"])(
    "missing declared input stays unavailable: %s",
    async (name) => {
      const files: Record<string, string> = entries();
      delete files[name];
      await expect(run(files)).rejects.toMatchObject({ reason: "secret_unavailable" });
    },
  );
  it.each([
    "short",
    Buffer.alloc(31).toString("base64"),
    Buffer.alloc(32).toString("base64").replace(/=$/, ""),
  ])("returns decryption unavailable for unusable vault-key input: %s", async (value) => {
    await expect(
      run({ ...entries(), "secrets/trading.env": `WAITRON_CREDENTIALS_KEY=${value}` }),
    ).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it("uses later archive vault keys, ignoring ambient keys", async () => {
    vi.stubEnv("WAITRON_CREDENTIALS_KEY", Buffer.alloc(32, 6).toString("base64"));
    await expect(
      run({
        "secrets/secrets.env": "WAITRON_CREDENTIALS_KEY=wrong",
        "secrets/trading.env": "",
        "secrets/backup.env": env,
      }),
    ).resolves.toEqual(passed);
  });
  it("ignores a leftover retired key", async () => {
    expect(
      await run({
        ...entries(),
        "secrets/trading.env": ["WAITRON", "ACCOUNT", "KEY"].join("_") + "=bad",
      }),
    ).toEqual(passed);
  });
  it("keeps unavailable key/decryption inconclusive even beside a damaged row", async () => {
    damage("update persons set pin_hash='invalid'");
    await expect(
      run({ ...entries(), "secrets/trading.env": "WAITRON_CREDENTIALS_KEY=" }),
    ).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it.each([
    ["staff_roles", "name='Changed role'"],
    ["staff_roles", "hidden_at='2026-11-12T12:00:00.000Z'"],
    ["persons", "display_name='Changed', display_name_folded = 'changed'"],
    ["sign_in_challenges", "expires_at='2026-10-21T00:00:00.000Z' where kind='totp_enrolment'"],
    ["account_actions", "code_attempts=3"],
    ["webauthn_credentials", "counter=43"],
    ["recovery_codes", "used_at=null"],
    ["till_sessions", "ended_at=null"],
    ["dashboard_sessions", "last_seen_at='2026-10-21T00:00:00.000Z'"],
    ["sign_in_challenges", "challenge='AQIE' where kind='passkey_login'"],
    ["sign_in_challenges", "nonce='AQIE' where kind='google_login'"],
    ["device_profile_admission_roles", "device_profile_id='other-profile'"],
  ])("preserves all captured rows in %s", async (table, change) => {
    damage(`update ${table} set ${change}`, "after");
    expect((await run()).checks).toContainEqual({ code: "data", status: "invalid" });
  });
  it.each([
    ["persons", "pin_hash='plaintext'"],
    ["persons", "password_hash='scrypt$00$00'"],
    ["persons", "password_hash='scrypt$" + "gg".repeat(16) + "$" + "a".repeat(64) + "'"],
    ["recovery_codes", "code_hash='" + "z".repeat(64) + "'"],
    ["till_sessions", "token_hash='" + "z".repeat(64) + "'"],
    ["dashboard_sessions", "token_hash='" + "z".repeat(64) + "'"],
    ["account_actions", "code_hash='" + "z".repeat(64) + "'"],
    ["account_actions", "token_hash='" + "z".repeat(64) + "'"],
    ["webauthn_credentials", "public_key='AQID'"],
    ["webauthn_credentials", "credential_id='@bad'"],
    ["webauthn_credentials", "counter=-1"],
    ["webauthn_credentials", "transports='{}'"],
    ["sign_in_challenges", "challenge='@bad' where kind='passkey_login'"],
    ["sign_in_challenges", "state_hash='" + "z".repeat(64) + "' where kind='google_login'"],
    ["sign_in_challenges", "verifier='bad' where kind='google_login'"],
    ["sign_in_challenges", "nonce='bad' where kind='google_login'"],
  ])("refuses malformed authenticator representation in %s: %s", async (table, change) => {
    damage(`update ${table} set ${change}`);
    expect(await run()).toEqual(verdict("invalid", "passed"));
  });
  it.each([
    ["till_sessions", ""],
    ["dashboard_sessions", ""],
    ["sign_in_challenges", "totp_enrolment"],
    ["sign_in_challenges", "passkey_registration"],
    ["sign_in_challenges", "google_link"],
  ])("checks stored person references on damaged copies: %s %s", async (table, kind) => {
    damage("pragma foreign_keys=off");
    try {
      const sourceKind =
        kind === "passkey_registration"
          ? "passkey_login"
          : kind === "google_link"
            ? "google_login"
            : kind;
      damage(
        `update ${table} set ${kind ? `kind='${kind}',` : ""}person_id='10000000-0000-4000-8000-999999999999'${kind ? ` where kind='${sourceKind}'` : ""}`,
      );
    } finally {
      damage("pragma foreign_keys=on");
    }
    expect(await run()).toEqual(verdict("invalid", "passed"));
  });
  it("accepts explicitly absent optional authenticators and empty ceremony tables", async () => {
    for (const table of IDENTITY_CLASSIFICATION.map((c) => c.table)
      .reverse()
      .filter((t) => t !== "persons"))
      damage(`delete from ${table}`);
    damage("update persons set pin_hash=null,password_hash=null,totp_secret=null");
    expect(await run()).toEqual(passed);
  });
  it("issues no login, consumes no proof and derives no supplied PIN or password", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network forbidden");
    });
    const forbidden = ["scrypt", "scryptSync", "randomUUID", "randomBytes"] as const;
    const spies = forbidden.map((name) =>
      vi.spyOn(crypto, name).mockImplementation(() => {
        throw new Error("Operational identity action forbidden");
      }),
    );
    syncBuiltinESMExports();
    try {
      await expect(run()).resolves.toEqual(passed);
      expect(original.db.all(sql`select code_attempts, used_at from account_actions`)).toEqual([
        { code_attempts: 2, used_at: null },
      ]);
      expect(original.db.all(sql`select used_at from recovery_codes`)).toEqual([{ used_at: now }]);
      expect(original.db.all(sql`select count(*) as n from till_sessions`)).toEqual([{ n: 1 }]);
      expect(original.db.all(sql`select count(*) as n from dashboard_sessions`)).toEqual([
        { n: 1 },
      ]);
      expect(fetcher).not.toHaveBeenCalled();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      syncBuiltinESMExports();
    }
  });
});

it.each(["before", "after", "both"] as const)(
  "checks a malformed credential in %s independently of equality",
  async (side) => {
    damage("update persons set pin_hash='plaintext'", side);
    expect(await run()).toEqual(verdict("invalid", "passed"));
  },
);
it("does not lose unsupported semantics when a later row is invalid", async () => {
  const future = Buffer.from(
    isoCBOR.encode(
      new Map([
        [1, 1],
        [3, -999],
      ]),
    ),
  ).toString("base64url");
  damage(`update webauthn_credentials set public_key='${future}'`);
  damage(`update recovery_codes set code_hash='${"z".repeat(64)}'`);
  expect(await run()).toEqual(verdict("unsupported", "passed"));
});
it("unknown stored password algorithms remain unsupported", async () => {
  damage("update persons set password_hash='future$stored$hash'");
  expect(await run()).toEqual(verdict("unsupported", "passed"));
});
it.each(["password_hash", "pin_hash"])(
  "malformed known password representation refuses: %s",
  async (column) => {
    damage(`update persons set ${column}='scrypt$00$${"f".repeat(64)}'`);
    expect(await run()).toEqual(verdict("invalid", "passed"));
  },
);
it.each(["ec", "rsa"] as const)("accepts a real %s authenticator public key", async (type) => {
  const key =
    type === "ec"
      ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" })
      : generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
  const values: [number, number | Uint8Array][] =
    type === "ec"
      ? [
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(key.x!, "base64url")],
          [-3, Buffer.from(key.y!, "base64url")],
        ]
      : [
          [1, 3],
          [3, -257],
          [-1, Buffer.from(key.n!, "base64url")],
          [-2, Buffer.from(key.e!, "base64url")],
        ];
  const encoded = Buffer.from(isoCBOR.encode(new Map(values))).toString("base64url");
  damage(`update webauthn_credentials set public_key='${encoded}',transports=null`);
  expect(await run()).toEqual(passed);
});
it.each([
  "a0",
  "a10101",
  "a201020326",
  "a40101032720062100",
  "a4010103272006214100",
  "a4010203262002214100",
  "a2010303390100",
  "80",
])("refuses malformed or conflicting COSE key material: %s", async (hex) => {
  damage(
    `update webauthn_credentials set public_key='${Buffer.from(hex, "hex").toString("base64url")}'`,
  );
  expect(await run()).toEqual(verdict("invalid", "passed"));
});
it.each(["not-json", '["usb",1]', '[""]'])(
  "refuses malformed transport payloads: %s",
  async (value) => {
    damage(`update webauthn_credentials set transports='${value}'`);
    expect(await run()).toEqual(verdict("invalid", "passed"));
  },
);
it("permits an absent optional email code", async () => {
  damage("update account_actions set code_hash=null,code_expires_at=null");
  expect(await run()).toEqual(passed);
});
it("retains a legitimate pending Google link to a suspended person", async () => {
  damage(
    `update sign_in_challenges set kind='google_link',person_id='${second}' where kind='google_login'`,
  );
  damage(
    `update sign_in_challenges set kind='passkey_registration',person_id='${second}' where kind='passkey_login'`,
  );
  expect(await run()).toEqual(passed);
});
it.each([
  ["a sign-in challenge naming a person", (p: string) => `kind='passkey_login',person_id='${p}'`],
  ["a registration challenge naming no person", () => "kind='passkey_registration',person_id=null"],
  ["a fresh check challenge naming no person", () => "kind='passkey_check',person_id=null"],
])("refuses %s", async (_name, change) => {
  damage("pragma ignore_check_constraints=on");
  damage(`update sign_in_challenges set ${change(second)} where kind='passkey_login'`);
  damage("pragma ignore_check_constraints=off");
  expect(await run()).toEqual(verdict("invalid", "passed"));
});
it("refuses an unknown sign-in challenge kind", async () => {
  damage("pragma ignore_check_constraints=on");
  damage("update sign_in_challenges set kind='unknown' where kind='passkey_login'");
  damage("pragma ignore_check_constraints=off");
  expect(await run()).toEqual(verdict("invalid", "passed"));
});
it("refuses a Google link without its person", async () => {
  damage("pragma ignore_check_constraints=on");
  damage("update sign_in_challenges set kind='google_link' where kind='google_login'");
  damage("pragma ignore_check_constraints=off");
  expect(await run()).toEqual(verdict("invalid", "passed"));
});
it("empty identity tables are a valid preserved set", async () => {
  for (const table of [...IDENTITY_CLASSIFICATION].reverse().map((c) => c.table))
    damage(`delete from ${table}`);
  expect(await run()).toEqual(passed);
});

it.each([
  ["persons", "pin_hash=x'00'", "data"],
  ["persons", "totp_secret=x'00'", "secret"],
  ["webauthn_credentials", "transports=x'00'", "data"],
  ["webauthn_credentials", "public_key='@bad'", "data"],
])(
  "refuses SQLite values outside the declared stored format: %s %s",
  async (table, change, check) => {
    damage(`update ${table} set ${change}`);
    expect(await run()).toEqual(
      verdict(check === "data" ? "invalid" : "passed", check === "secret" ? "invalid" : "passed"),
    );
  },
);
it("accepts an absent predecessor only with an empty migrated owner", async () => {
  for (const table of [...IDENTITY_CLASSIFICATION].reverse().map((c) => c.table))
    damage(`delete from ${table}`);
  expect(await run(entries(), true)).toEqual(passed);
  await seedPersons(restored.db, { id: person, displayName: "Unexpected", createdAt: now });
  expect((await run(entries(), true)).checks).toContainEqual({ code: "data", status: "invalid" });
});

it("accepts a noncanonical explicit spelling of the actual decrypting vault key", async () => {
  await expect(
    run({
      ...entries(),
      "secrets/trading.env": `WAITRON_CREDENTIALS_KEY=${vault.toString("base64")}=`,
    }),
  ).resolves.toEqual(passed);
});
it.each(["A", "AAA", "AAAAAA", "AB"])(
  "refuses authenticated incomplete base32 bytes: %s",
  async (value) => {
    const cipher = sealText(ring, "totp", value);
    damage(
      `update sign_in_challenges set encrypted_secret='${cipher}' where kind='totp_enrolment'`,
    );
    expect(await run()).toEqual(verdict("passed", "invalid"));
  },
);

it.each([
  "update staff_roles set name=''",
  "update staff_roles set colour='unknown'",
  "update staff_roles set position=1.5",
  "update staff_roles set hidden_at=x'00'",
  "update person_staff_roles set person_id='missing'",
  "update person_staff_roles set staff_role_id='missing'",
])("checks stored job-role data on both copies: %s", async (statement) => {
  for (const suite of [original, restored]) {
    suite.db.run(sql`pragma foreign_keys=off`);
    suite.db.run(sql`pragma ignore_check_constraints=on`);
    try {
      suite.db.run(sql.raw(statement));
    } finally {
      suite.db.run(sql`pragma ignore_check_constraints=off`);
      suite.db.run(sql`pragma foreign_keys=on`);
    }
  }
  expect(await run()).toEqual(verdict("invalid", "passed"));
});

it("preserves captured job-role memberships", async () => {
  expect(await run()).toEqual(passed);
  damage("delete from person_staff_roles", "after");
  expect((await run()).checks).toContainEqual({ code: "data", status: "invalid" });
});
