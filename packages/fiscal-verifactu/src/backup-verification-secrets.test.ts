import { createCipheriv, generateKeyPairSync } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import forge from "node-forge";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { BackupCheckUnavailable, type BackupVerificationContext } from "@waitron/module";
import { openBackupQuery } from "@waitron/store";
import { makeAuthority, type Candidate } from "../test/certificate-fixtures.js";
import { KEY_ONLY_CANDIDATE, RC2_CANDIDATE } from "../test/openssl-certificates.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { verifyBackupFiscalSecrets } from "./backup-verification-secrets.js";

const authority = makeAuthority();
const candidate = authority.issue({ passphrase: "private-passphrase-sentinel" });
const older = authority.issue();
const expired = authority.issue({ notAfter: new Date("2026-06-01T00:00:00.000Z") });
const future = authority.issue({ notBefore: new Date("2028-01-01T00:00:00.000Z") });
const noKey = authority.issue({ withKey: false });
const foreign = authority.issue({ organizationIdentifier: "VATES-A11111111" });
const personal = authority.issue({ organizationIdentifier: null, organisation: null });
const unrelatedKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const parsedPfx = forge.pkcs12.pkcs12FromAsn1(
  forge.asn1.fromDer(candidate.pfx.toString("binary")),
  candidate.passphrase,
);
const certBag = parsedPfx.getBags({ bagType: forge.pki.oids.certBag! })[
  forge.pki.oids.certBag!
]![0]!;
const mismatchedPfx = Buffer.from(
  forge.asn1
    .toDer(
      forge.pkcs12.toPkcs12Asn1(
        forge.pki.privateKeyFromPem(unrelatedKey),
        certBag.cert!,
        candidate.passphrase,
        { algorithm: "aes256" },
      ),
    )
    .getBytes(),
  "binary",
);
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const key = Buffer.alloc(32, 23).toString("base64");
const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: key });
const createdAt = "2026-10-20T08:00:00.000Z";
const oldAt = "2026-09-01T08:00:00.000Z";
const secretsEnv = Buffer.from(`WAITRON_CREDENTIALS_KEY=${key}\n`);
const installId = "10000000-0000-4000-8000-000000000012";
let directory: string | undefined;
let entries: Record<string, Uint8Array | null>;

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function payload(cert = candidate) {
  return { pfxBase64: cert.pfx.toString("base64"), passphrase: cert.passphrase, certKind: "sello" };
}
async function capture(cert: Candidate | null = candidate) {
  await seedTenants(suite.db);
  if (cert !== null) {
    await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: () => new Date(oldAt) },
      payload(older),
    );
    await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId2, now: () => new Date(createdAt) },
      payload(older),
    );
    await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: () => new Date(createdAt) },
      payload(cert),
    );
    await suite.db.execute(sql`insert into fiscal_certificate_reminders
      (id,node_id,install_id,stage,person_id,status,claimed_at,reported_at)
      select ${installId},node_id,id,'warning','10000000-0000-4000-8000-000000000013','sent',${createdAt},${createdAt}
      from fiscal_certificate_installs where node_id=${TENANT_A.nodeId} and installed_at=${oldAt}`);
  }
  entries = {
    "secrets/secrets.env": secretsEnv,
    "secrets/trading.env": Buffer.alloc(0),
    "secrets/backup.env": null,
  };
  directory = await mkdtemp(join(tmpdir(), "waitron-backup-certificate-"));
  const file = suite.db
    .all<{ file: string }>(sql`pragma database_list`)
    .find((r) => r.file.endsWith("venue.db"))!.file;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    await backup(db, join(directory, "before.db"));
    await backup(db, join(directory, "after.db"));
  } finally {
    db.close();
  }
}
function edit(side: "before" | "after", run: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(join(directory!, `${side}.db`));
  try {
    db.exec("pragma foreign_keys=off; pragma ignore_check_constraints=on");
    const triggers = db
      .prepare("select name,sql,tbl_name from sqlite_schema where type='trigger'")
      .all() as { name: string; sql: string; tbl_name: string }[];
    for (const t of triggers) db.exec(`drop trigger "${t.name.replaceAll('"', '""')}"`);
    run(db);
    for (const t of triggers)
      if (db.prepare("select 1 from sqlite_schema where type='table' and name=?").get(t.tbl_name))
        db.exec(t.sql);
  } finally {
    db.close();
  }
}
function both(run: (db: DatabaseSync) => void) {
  edit("before", run);
  edit("after", run);
}
async function replace(value: Record<string, string>) {
  await withTransaction(suite.db, (tx) =>
    putCredential(tx, ring, { purpose: "fiscal.aeat", value }),
  );
  const row = suite.db.all<Record<string, string | number | Uint8Array>>(
    sql`select ciphertext,iv,auth_tag,key_version from tenant_credentials where purpose='fiscal.aeat'`,
  )[0]!;
  both((db) =>
    db
      .prepare(
        "update tenant_credentials set ciphertext=?,iv=?,auth_tag=?,key_version=? where purpose='fiscal.aeat'",
      )
      .run(row.ciphertext!, row.iv!, row.auth_tag!, row.key_version!),
  );
}
async function verify(options: { sourceSchema?: number | null; nodeId?: string } = {}) {
  const before = await openBackupQuery(join(directory!, "before.db"));
  try {
    const after = await openBackupQuery(join(directory!, "after.db"));
    try {
      const context: BackupVerificationContext = {
        before: before.query,
        after: after.query,
        entries: {
          read: async (name) => {
            if (!(name in entries)) throw new Error("undeclared private entry");
            return entries[name]!;
          },
        },
        source: {
          nodeId: options.nodeId ?? TENANT_A.nodeId,
          locationId: TENANT_A.locationId,
          environment: "preproduction",
          createdAt,
        },
        sourceSchema: options.sourceSchema === undefined ? 1 : options.sourceSchema,
        targetSchema: 1,
        signal: new AbortController().signal,
      };
      return await verifyBackupFiscalSecrets(context);
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
const result = (status: "passed" | "invalid" | "unsupported") => ({
  status,
  checks: [{ code: "secret", status }],
});

it("opens captured PFX without signing or network and emits only a fixed result", async () => {
  await capture();
  const checks = await import("./certificate-check.js");
  const installs = await import("./certificate-install.js");
  const records = await import("./certificate-record.js");
  const credentials = await import("@waitron/credentials");
  const transport = await import("./aeat-transport.js");
  const crypto = await import("node:crypto");
  const tls = await import("node:tls");
  const forbidden = () => {
    throw new Error("operational certificate effect attempted");
  };
  const spies = [
    vi.spyOn(checks, "checkWithAuthority").mockImplementation(forbidden),
    vi.spyOn(installs, "installCertificate").mockImplementation(forbidden),
    vi.spyOn(records, "recordInstall").mockImplementation(forbidden),
    vi.spyOn(credentials, "putCredential").mockImplementation(forbidden),
    vi.spyOn(transport, "mtlsFetch").mockImplementation(forbidden),
    vi.spyOn(crypto.default, "sign").mockImplementation(forbidden),
    vi.spyOn(crypto.default, "createSign").mockImplementation(forbidden),
    vi.spyOn(tls.default, "connect").mockImplementation(forbidden),
  ];
  syncBuiltinESMExports();
  vi.stubGlobal("fetch", forbidden);
  const answer = await verify();
  expect(answer).toEqual(result("passed"));
  const text = JSON.stringify(answer);
  for (const sentinel of [
    candidate.passphrase,
    candidate.fingerprint,
    "89890001K",
    TENANT_A.nodeId,
    candidate.pfx.toString("base64"),
    key,
  ])
    expect(text).not.toContain(sentinel);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
it.each([expired, future])(
  "accepts intact expired or not-yet-valid material without renewal %#",
  async (cert) => {
    await capture(cert);
    expect(await verify()).toEqual(result("passed"));
  },
);
it("selects only the source node's latest install while retaining another node's history", async () => {
  await capture();
  both((db) =>
    db
      .prepare(
        "update fiscal_certificate_installs set installed_at='2027-01-01T00:00:00.000Z' where node_id=?",
      )
      .run(TENANT_A.nodeId2),
  );
  expect(await verify()).toEqual(result("passed"));
});
it("does not accept an older source-node certificate", async () => {
  await capture();
  await replace(payload(older));
  expect(await verify()).toEqual(result("invalid"));
});
it("accepts a source with one genuine installation", async () => {
  await capture();
  both((db) => db.prepare("delete from fiscal_certificate_reminders;").run());
  both((db) =>
    db.prepare("delete from fiscal_certificate_installs where installed_at=?").run(oldAt),
  );
  expect(await verify()).toEqual(result("passed"));
});
it.each(["before", "after"] as const)("checks the source-node relationship in %s", async (side) => {
  await capture();
  edit(side, (db) =>
    db
      .prepare(
        "update fiscal_certificate_installs set fingerprint='wrong-fingerprint' where node_id=? and installed_at=?",
      )
      .run(TENANT_A.nodeId, createdAt),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it.each([
  ["kind", "representante"],
  ["organisation", "different organisation"],
  ["tax_id", "A11111111"],
  ["issuer", "different issuer"],
  ["valid_from", "2026-02-01T00:00:00.000Z"],
  ["valid_until", "2029-01-01T00:00:00.000Z"],
])("binds the latest install's %s to the PFX", async (column, value) => {
  await capture();
  both((db) =>
    db
      .prepare(
        `update fiscal_certificate_installs set ${column}=? where node_id=? and installed_at=?`,
      )
      .run(value, TENANT_A.nodeId, createdAt),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it.each([
  "fingerprint",
  "organisation",
  "tax_id",
  "issuer",
  "source",
  "person_id",
  "checked_endpoint",
  "checked_at",
  "valid_from",
  "valid_until",
])("preserves the historical install field %s", async (column) => {
  await capture();
  edit("after", (db) =>
    db
      .prepare(`update fiscal_certificate_installs set ${column}='changed' where node_id=?`)
      .run(TENANT_A.nodeId2),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it.each(["node_id", "install_id", "stage", "person_id", "status", "claimed_at", "reported_at"])(
  "preserves reminder field %s",
  async (column) => {
    await capture();
    edit("after", (db) => db.exec(`update fiscal_certificate_reminders set ${column}='changed'`));
    expect(await verify()).toEqual(result("invalid"));
  },
);
it("requires an unambiguous latest source-node install", async () => {
  await capture();
  both((db) =>
    db
      .prepare("update fiscal_certificate_installs set installed_at=? where node_id=?")
      .run(createdAt, TENANT_A.nodeId),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it("refuses a credential with no corresponding source install", async () => {
  await capture();
  both((db) =>
    db.prepare("delete from fiscal_certificate_installs where node_id=?").run(TENANT_A.nodeId),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it("requires the source-node secret despite retained install history", async () => {
  await capture();
  both((db) => db.exec("delete from tenant_credentials where purpose='fiscal.aeat'"));
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("secret_unavailable"));
});
it.each(["secrets/secrets.env", "secrets/trading.env"])(
  "keeps missing %s unavailable",
  async (name) => {
    await capture();
    entries[name] = null;
    await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("secret_unavailable"));
  },
);
it("uses later archived key inputs and never the process environment", async () => {
  await capture();
  vi.stubEnv("WAITRON_CREDENTIALS_KEY", key);
  entries["secrets/trading.env"] = Buffer.from(
    `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 24).toString("base64")}\n`,
  );
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("decryption_unavailable"));
  entries["secrets/backup.env"] = secretsEnv;
  expect(await verify()).toEqual(result("passed"));
});
it("keeps an unconfirmed PFX passphrase unavailable rather than corrupt", async () => {
  await capture();
  await replace({ ...payload(), passphrase: "wrong-private-passphrase" });
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("decryption_unavailable"));
});
it.each([
  { ...payload(), pfxBase64: "!!!!" },
  { ...payload(), pfxBase64: "AA==" },
  { ...payload(), certKind: "unknown-kind" },
  payload(noKey),
  { ...payload(), pfxBase64: mismatchedPfx.toString("base64") },
  {
    pfxBase64: KEY_ONLY_CANDIDATE.pfxBase64,
    passphrase: KEY_ONLY_CANDIDATE.passphrase,
    certKind: "sello",
  },
])("rejects malformed known certificate material %#", async (value) => {
  await capture();
  await replace(value);
  expect(await verify()).toEqual(result("invalid"));
});
it("keeps a supported vault with unsupported PFX encryption unsupported", async () => {
  await capture();
  await replace({
    pfxBase64: RC2_CANDIDATE.pfxBase64,
    passphrase: RC2_CANDIDATE.passphrase,
    certKind: "sello",
  });
  expect(await verify()).toEqual(result("unsupported"));
});
it("checks the migrated credential instead of only the original", async () => {
  await capture();
  edit("after", (db) =>
    db.exec("update tenant_credentials set auth_tag=zeroblob(16) where purpose='fiscal.aeat'"),
  );
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("decryption_unavailable"));
});
it("does not turn failed reads into certificate corruption", async () => {
  await capture();
  both((db) => db.exec("drop table nodes"));
  await expect(verify()).rejects.toThrow();
});
it("binds the opened taxpayer certificate to the captured tenant", async () => {
  await capture(foreign);
  expect(await verify()).toEqual(result("invalid"));
});
it("accepts a personal certificate without inventing a subject taxpayer", async () => {
  await capture(personal);
  expect(await verify()).toEqual(result("passed"));
});
it("requires the captured source node to belong to its captured location", async () => {
  await capture();
  both((db) =>
    db.prepare("update nodes set location_id=? where id=?").run(TENANT_A.nodeId, TENANT_A.nodeId),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it("permits an explicitly absent fiscal predecessor only without certificate evidence", async () => {
  await capture(null);
  expect(await verify({ sourceSchema: 0 })).toEqual(result("passed"));
});
it("cannot use a zero-schema claim to bypass retained certificate evidence", async () => {
  await capture();
  both((db) => db.exec("delete from tenant_credentials where purpose='fiscal.aeat'"));
  await expect(verify({ sourceSchema: 0 })).rejects.toEqual(
    new BackupCheckUnavailable("secret_unavailable"),
  );
});
it("returns a fixed invalid result for an authenticated malformed vault payload", async () => {
  await capture();
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(Buffer.from("fiscal.aeat"));
  const ciphertext = Buffer.concat([
    cipher.update('{"private-sentinel":"bad-payload"}'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  both((db) =>
    db
      .prepare(
        "update tenant_credentials set ciphertext=?,iv=?,auth_tag=? where purpose='fiscal.aeat'",
      )
      .run(ciphertext, iv, tag),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it("keeps a positive-schema source with no certificate unavailable", async () => {
  await capture(null);
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("secret_unavailable"));
});
it("cannot certify a zero predecessor when migration invents certificate evidence", async () => {
  await capture();
  edit("before", (db) => {
    db.exec(
      "delete from tenant_credentials; delete from fiscal_certificate_reminders; delete from fiscal_certificate_installs",
    );
  });
  expect(await verify({ sourceSchema: null })).toEqual(result("invalid"));
});
it("keeps absent vault schema unavailable for a positive fiscal source", async () => {
  await capture();
  both((db) => db.exec("drop table tenant_credentials"));
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("secret_unavailable"));
});
it("refuses a usable credential with no installation-history schema", async () => {
  await capture();
  both((db) => db.exec("drop table fiscal_certificate_installs"));
  expect(await verify()).toEqual(result("invalid"));
});
it("cannot bind material when the captured tenant is absent", async () => {
  await capture();
  both((db) => db.exec("delete from tenants"));
  expect(await verify()).toEqual(result("invalid"));
});
