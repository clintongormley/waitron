import crypto, { createHmac, generateKeyPairSync } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, deviceProfiles, devices, locations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import {
  validateBackupModuleResult,
  validateBackupVerificationContribution,
} from "@waitron/module";
import { IDENTITY_BACKUP_VERIFICATION } from "./index.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { IDENTITY_CLASSIFICATION } from "./classification.js";
import { encryptTotpSecret } from "./mfa.js";
import { hashSecret } from "./secret-hash.js";
import * as schema from "./schema/index.js";

const original = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const restored = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const withoutIdentity = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const person = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const device = "10000000-0000-4000-8000-000000000003";
const location = "10000000-0000-4000-8000-000000000004";
const profile = "10000000-0000-4000-8000-000000000005";
const now = "2026-10-20T08:00:00.000Z";
const old = "2026-10-01T08:00:00.000Z";
const end = "2026-10-20T09:00:00.000Z";
const vault = Buffer.alloc(32, 2);
const account = createHmac("sha256", vault).update("waitron.account-key.v1").digest();
const totpKey = createHmac("sha256", account).update("waitron.totp.v1").digest();
const secret = "JBSWY3DPEHPK3PXP";
const encrypted = encryptTotpSecret(secret, { version: 1, key: totpKey });
const pending = encryptTotpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", { version: 1, key: totpKey });
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
    await suite.db
      .insert(locations)
      .values({ id: location, name: "Main", invoiceLocales: ["en"], operationDescription: "Sale" });
    await suite.db
      .insert(deviceProfiles)
      .values({ id: profile, name: "Till", formFactor: "till", capabilities: [] });
    await suite.db.insert(devices).values({
      id: device,
      locationId: location,
      deviceProfileId: profile,
      label: "Till",
      tokenHash: "fixture",
      enrolledAt: now,
      createdAt: now,
    });
    await suite.db.insert(schema.persons).values([
      {
        id: person,
        displayName: "First",
        passwordHash: password,
        pinHash: pin,
        totpSecret: encrypted,
        createdAt: old,
      },
      { id: second, displayName: "Second", role: "manager", status: "suspended", createdAt: now },
    ]);
    await suite.db.insert(schema.totpEnrollments).values({
      id: person,
      personId: second,
      encryptedSecret: pending,
      expiresAt: end,
      createdAt: old,
    });
    await suite.db.insert(schema.sessions).values({
      id: person,
      personId: person,
      deviceId: device,
      tokenHash: digest,
      openedAt: old,
      endedAt: now,
    });
    await suite.db
      .insert(schema.managementSessions)
      .values({ id: person, personId: person, tokenHash: digest, createdAt: old, lastSeenAt: now });
    await suite.db
      .insert(schema.recoveryCodes)
      .values({ id: person, personId: person, codeHash: digest, createdAt: old, usedAt: now });
    await suite.db.insert(schema.managementAccountActions).values({
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
    await suite.db
      .insert(schema.webauthnChallenges)
      .values({ id: person, personId: null, challenge: "AQID", createdAt: old });
    await suite.db.insert(schema.googleOidcStates).values({
      id: person,
      personId: null,
      mode: "login",
      stateHash: digest,
      nonce: Buffer.alloc(32, 3).toString("base64url"),
      verifier: Buffer.alloc(48, 4).toString("base64url"),
      expiresAt: end,
    });
    await suite.db
      .insert(schema.deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profile, personId: second, admitted: false });
    await suite.db
      .insert(schema.deviceProfileAdmissionRoles)
      .values({ deviceProfileId: profile, role: "manager" });
  }
});
afterEach(() => vi.unstubAllEnvs());

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
          locationId: location,
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
  it("authenticates every person and pending-enrolment TOTP value under the account-derived version-one key", async () => {
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
  it.each(["before", "after", "both"] as const)(
    "authenticates an older person ciphertext in %s",
    async (side) => {
      damage(
        "update persons set totp_secret='" +
          encrypted.slice(0, -2) +
          "AA' where id='" +
          person +
          "'",
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
      damage("update totp_enrollments set encrypted_secret='" + pending.slice(0, -2) + "AA'", side);
      await expect(run()).rejects.toMatchObject({ reason: "decryption_unavailable" });
    },
  );
  it.each(["persons", "totp_enrollments"])(
    "unknown stored TOTP version stays unsupported: %s",
    async (table) => {
      const column = table === "persons" ? "totp_secret" : "encrypted_secret";
      const value = encryptTotpSecret(secret, { version: 7, key: vault });
      damage(`update ${table} set ${column}='${value}'`);
      expect(await run()).toEqual(verdict("passed", "unsupported"));
    },
  );
  it.each(["v2.1.a.b.c", "v1.x.a.b.c"])(
    "unknown encrypted TOTP format stays unsupported: %s",
    async (value) => {
      damage(`update persons set totp_secret='${value}'`);
      expect(await run()).toEqual(verdict("passed", "unsupported"));
    },
  );
  it.each(["v1.1.a.b", "v1.1.AA.AA.AA"])(
    "malformed known ciphertext is invalid: %s",
    async (value) => {
      damage(`update totp_enrollments set encrypted_secret='${value}'`);
      expect(await run()).toEqual(verdict("passed", "invalid"));
    },
  );
  it.each(["", "not a base32 secret!"])(
    "authenticated malformed plaintext is invalid: %s",
    async (value) => {
      const encryptedBad = encryptTotpSecret(value, { version: 1, key: totpKey });
      damage(`update totp_enrollments set encrypted_secret='${encryptedBad}'`);
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
  ])("malformed explicit account key is unavailable: %s", async (value) => {
    await expect(
      run({ ...entries(), "secrets/trading.env": `WAITRON_ACCOUNT_KEY=${value}` }),
    ).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it("uses the explicit account key and later archive files, ignoring ambient keys", async () => {
    vi.stubEnv("WAITRON_ACCOUNT_KEY", Buffer.alloc(32, 6).toString("base64"));
    await expect(
      run({
        "secrets/secrets.env": "WAITRON_CREDENTIALS_KEY=wrong",
        "secrets/trading.env": "WAITRON_ACCOUNT_KEY=wrong",
        "secrets/backup.env": `WAITRON_ACCOUNT_KEY=${account.toString("base64")}`,
      }),
    ).resolves.toEqual(passed);
  });
  it("falls back from an empty explicit account key to the current vault key", async () => {
    expect(await run({ ...entries(), "secrets/trading.env": "WAITRON_ACCOUNT_KEY=" })).toEqual(
      passed,
    );
  });
  it("keeps unavailable key/decryption inconclusive even beside a damaged row", async () => {
    damage("update persons set pin_hash='invalid'");
    await expect(
      run({ ...entries(), "secrets/trading.env": "WAITRON_CREDENTIALS_KEY=" }),
    ).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it.each([
    ["persons", "display_name='Changed'"],
    ["totp_enrollments", "expires_at='2026-10-21T00:00:00.000Z'"],
    ["management_account_actions", "code_attempts=3"],
    ["webauthn_credentials", "counter=43"],
    ["recovery_codes", "used_at=null"],
    ["sessions", "ended_at=null"],
    ["management_sessions", "last_seen_at='2026-10-21T00:00:00.000Z'"],
    ["webauthn_challenges", "challenge='AQIE'"],
    ["google_oidc_states", "nonce='AQIE'"],
    ["device_profile_admission_roles", "role='admin'"],
    ["device_profile_admission_persons", "admitted=1"],
  ])("preserves all captured rows in %s", async (table, change) => {
    damage(`update ${table} set ${change}`, "after");
    expect((await run()).checks).toContainEqual({ code: "data", status: "invalid" });
  });
  it.each([
    ["persons", "pin_hash='plaintext'"],
    ["persons", "password_hash='scrypt$00$00'"],
    ["persons", "password_hash='scrypt$" + "gg".repeat(16) + "$" + "a".repeat(64) + "'"],
    ["recovery_codes", "code_hash='" + "z".repeat(64) + "'"],
    ["sessions", "token_hash='" + "z".repeat(64) + "'"],
    ["management_sessions", "token_hash='" + "z".repeat(64) + "'"],
    ["management_account_actions", "code_hash='" + "z".repeat(64) + "'"],
    ["management_account_actions", "token_hash='" + "z".repeat(64) + "'"],
    ["webauthn_credentials", "public_key='AQID'"],
    ["webauthn_credentials", "credential_id='@bad'"],
    ["webauthn_credentials", "counter=-1"],
    ["webauthn_credentials", "transports='{}'"],
    ["webauthn_challenges", "challenge='@bad'"],
    ["google_oidc_states", "state_hash='" + "z".repeat(64) + "'"],
    ["google_oidc_states", "verifier='bad'"],
    ["google_oidc_states", "nonce='bad'"],
  ])("refuses malformed authenticator representation in %s: %s", async (table, change) => {
    damage(`update ${table} set ${change}`);
    expect(await run()).toEqual(verdict("invalid", "passed"));
  });
  it.each([
    "sessions",
    "management_sessions",
    "totp_enrollments",
    "webauthn_challenges",
    "google_oidc_states",
  ])("checks logical person references absent from SQL foreign keys: %s", async (table) => {
    damage(`update ${table} set person_id='10000000-0000-4000-8000-999999999999'`);
    expect(await run()).toEqual(verdict("invalid", "passed"));
  });
  it("accepts explicitly absent optional authenticators and empty ceremony tables", async () => {
    for (const table of IDENTITY_CLASSIFICATION.map((c) => c.table).filter((t) => t !== "persons"))
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
      expect(
        original.db.all(sql`select code_attempts, used_at from management_account_actions`),
      ).toEqual([{ code_attempts: 2, used_at: null }]);
      expect(original.db.all(sql`select used_at from recovery_codes`)).toEqual([{ used_at: now }]);
      expect(original.db.all(sql`select count(*) as n from sessions`)).toEqual([{ n: 1 }]);
      expect(original.db.all(sql`select count(*) as n from management_sessions`)).toEqual([
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
  damage("update management_account_actions set code_hash=null,code_expires_at=null");
  expect(await run()).toEqual(passed);
});
it("retains a legitimate pending Google link to a suspended person", async () => {
  damage(`update google_oidc_states set mode='link',person_id='${second}'`);
  damage(`update webauthn_challenges set person_id='${second}'`);
  expect(await run()).toEqual(passed);
});
it("refuses a Google link without its person", async () => {
  damage("update google_oidc_states set mode='link'");
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
  restored.db.run(
    sql`insert into persons (id,display_name,created_at) values (${person},'Unexpected',${now})`,
  );
  expect((await run(entries(), true)).checks).toContainEqual({ code: "data", status: "invalid" });
});

it("refuses a noncanonical explicit spelling of the actual decrypting account key", async () => {
  await expect(
    run({
      ...entries(),
      "secrets/trading.env": `WAITRON_ACCOUNT_KEY=${account.toString("base64")}=`,
    }),
  ).rejects.toMatchObject({ reason: "decryption_unavailable" });
});
it.each(["A", "AAA", "AAAAAA", "AB"])(
  "refuses authenticated incomplete base32 bytes: %s",
  async (value) => {
    const cipher = encryptTotpSecret(value, { version: 1, key: totpKey });
    damage(`update totp_enrollments set encrypted_secret='${cipher}'`);
    expect(await run()).toEqual(verdict("passed", "invalid"));
  },
);
