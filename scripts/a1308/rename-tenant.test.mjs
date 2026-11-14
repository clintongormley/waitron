import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { coveredFiles, main, renamePath, renameText, residuals } from "./rename-tenant.mjs";

const shields = [
  "registros_tenant_node_secuencia_uq",
  "TenantTransport",
  "tenantsWithWork",
  "drain.tenant_skipped",
  "TENANT_A",
  "TENANT_B",
  "seedTenantWithSif",
  "seedTenantNodeSif",
  "seedTenants",
  "persons_tenant_email_uq",
  "persons_tenant_live_display_name_uq",
  "persons_tenant_pending_email_uq",
  "persons_tenant_google_subject_uq",
  "working_orders_tenant_status_idx",
  "sales_tenant_issued_idx",
  "print_agents_tenant_node_key",
  "purchase_invoices_tenant_received_idx",
  "tenant_id",
  "tenant_ids",
  "tenantId",
  "tenantIds",
  "tenantID",
  "TenantId",
  "source_tenant_id",
  "sourceTenantId",
  "tenant_receipts",
  "tenantReceipts",
  "tenant_themes",
  "tenants_nif_key",
  "bootstrap-tenant",
  "--tenant",
  "tenants_country_tax_id_key",
];
const pairs = [
  ["WAITRON_TENANT_DOMAIN", "WAITRON_VENUE_DOMAIN"],
  ["TenantDomain", "VenueDomain"],
  ["tenantDomain", "venueDomain"],
  ["tenant_credentials", "venue_credentials"],
  ["tenantCredentials", "venueCredentials"],
  ["tenant-credentials", "venue-credentials"],
  ["TenantIncident", "VenueIncident"],
  ["tenantIncident", "venueIncident"],
  ["sumupClientForTenant", "sumupClientForVenue"],
  ["setupTenant", "setupVenue"],
  ["provisionTenant", "provisionVenue"],
  ["asTenant", "asVenue"],
  ["UnderNewTenant", "UnderNewVenue"],
  ["tenant-scoping", "no-bare-transaction"],
  ["tenants_singleton_ck", "taxpayer_singleton_ck"],
  ["TENANTS", "TAXPAYERS"],
  ["Tenants", "Taxpayers"],
  ["tenants", "taxpayer"],
  ["TENANT", "TAXPAYER"],
  ["Tenant", "Taxpayer"],
  ["tenant", "taxpayer"],
];
const roots = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "wt-vb1-rename-"));
  roots.push(root);
  git(root, "init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, "add", ".");
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it("maps the taxpayer row and its readers without changing their expressions", () => {
  expect(renameText("readTenant(tx) from tenants where tenants.id = 1; const tenant = row")).toBe(
    "readTaxpayer(tx) from taxpayer where taxpayer.id = 1; const taxpayer = row",
  );
});
it.each(pairs)("maps %s before shorter names", (before, after) => {
  expect(renameText(before)).toBe(after);
});
it.each(shields)("preserves reserved name %s alone and in context", (name) => {
  expect(renameText(name)).toBe(name);
  expect(renameText(`call(${name}); ${name}.value > 0`)).toBe(`call(${name}); ${name}.value > 0`);
});
it("does not mistake a longer identity name for the retired tenant_id field", () => {
  expect(
    renameText("provisioning.tenant_identity_mismatch readTenantIdentity tenant_ids_extra"),
  ).toBe("provisioning.taxpayer_identity_mismatch readTaxpayerIdentity taxpayer_ids_extra");
});
it("repeatedly maps the full reviewed vocabulary without touching reserved names", () => {
  const input = [...pairs.map(([before]) => before), ...shields].join("\n");
  const expected = [...pairs.map(([, after]) => after), ...shields].join("\n");
  expect(renameText(input)).toBe(expected);
  expect(renameText(renameText(input))).toBe(expected);
});
it("renames file paths by the same vocabulary", () => {
  expect(renamePath("packages/db/src/read-tenant.ts")).toBe("packages/db/src/read-taxpayer.ts");
  expect(renamePath("packages/db/src/schema/tenants.singleton.test.ts")).toBe(
    "packages/db/src/schema/taxpayer.singleton.test.ts",
  );
  expect(renamePath("packages/payments-stripe/src/tenant-scoping.test.ts")).toBe(
    "packages/payments-stripe/src/no-bare-transaction.test.ts",
  );
});
it("covers tracked source paths while excluding frozen, fiscal, retired and binary paths", () => {
  const skipped = [
    "packages/db/drizzle/a.sql",
    "packages/country-es/test-fixtures/a.json",
    "apps/server/src/testing/fixtures/configuration-v1-old.json",
    "packages/fiscal-verifactu/src/write-path.e2e.test.ts",
    "packages/fiscal-verifactu/src/inmutabilidad.test.ts",
    "scripts/no-tenant-column.test.ts",
    "scripts/a1308/rename-tenant.mjs",
    ...[
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "ico",
      "pdf",
      "woff",
      "woff2",
      "db",
      "sqlite",
      "p12",
      "pfx",
    ].map((ext) => `apps/image.${ext}`),
    "docs/current.md",
    "README.md",
  ];
  expect(
    coveredFiles([
      ...skipped,
      "apps/server/src/tenant.ts",
      "packages/db/src/read-tenant.ts",
      "scripts/check.mjs",
    ]),
  ).toEqual(["apps/server/src/tenant.ts", "packages/db/src/read-tenant.ts", "scripts/check.mjs"]);
});
it("reports every unreserved remaining occurrence with its source line", () => {
  expect(residuals("a.ts", "x tenant y\nTENANT_A\nsourceTenantId\nTeNaNt\n")).toEqual([
    "a.ts:1: x tenant y",
    "a.ts:4: TeNaNt",
  ]);
  expect(residuals("a.ts", "taxpayer\n")).toEqual([]);
});
it("previews, writes with git, reports, and repeats without modifying excluded or untracked files", async () => {
  const root = fixture({
    "packages/db/src/read-tenant.ts": "readTenant(tx); tenant_id;",
    "packages/db/src/stable.ts": "tenant",
    "packages/db/drizzle/x.sql": "tenants",
    "scripts/a1308/old.mjs": "tenant",
  });
  writeFileSync(join(root, "packages/db/src/untracked.ts"), "tenant");
  symlinkSync("read-tenant.ts", join(root, "packages/db/src/link.ts"));
  git(root, "add", "packages/db/src/link.ts");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(await main([], root)).toBe(1);
  expect(existsSync(join(root, "packages/db/src/read-taxpayer.ts"))).toBe(false);
  expect(readFileSync(join(root, "packages/db/src/read-tenant.ts"), "utf8")).toBe(
    "readTenant(tx); tenant_id;",
  );
  expect(output.mock.calls.flat().join("\n")).toContain("packages/db/src/read-tenant.ts");
  expect(await main(["--report"], root)).toBe(1);
  expect(output.mock.calls.flat().join("\n")).toContain(
    "packages/db/src/read-tenant.ts:1: readTenant(tx); tenant_id;",
  );
  expect(await main(["--write"], root)).toBe(0);
  expect(readFileSync(join(root, "packages/db/src/read-taxpayer.ts"), "utf8")).toBe(
    "readTaxpayer(tx); tenant_id;",
  );
  expect(git(root, "status", "--porcelain")).toContain("read-taxpayer.ts");
  const status = git(root, "status", "--porcelain");
  expect(await main(["--write"], root)).toBe(0);
  expect(await main([], root)).toBe(0);
  expect(await main(["--report"], root)).toBe(0);
  expect(git(root, "status", "--porcelain")).toBe(status);
  for (const file of [
    "packages/db/drizzle/x.sql",
    "scripts/a1308/old.mjs",
    "packages/db/src/untracked.ts",
  ])
    expect(readFileSync(join(root, file), "utf8")).toMatch(/tenant/);
});
it("runs the documented command line in the selected repository", () => {
  const root = fixture({ "apps/tenant.ts": "Tenant" });
  const script = fileURLToPath(new URL("./rename-tenant.mjs", import.meta.url));
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 5000,
    });
  expect(run().status).toBe(1);
  expect(run("--write").status).toBe(0);
  expect(readFileSync(join(root, "apps/taxpayer.ts"), "utf8")).toBe("Taxpayer");
  expect(run().status).toBe(0);
  expect(run("--report").status).toBe(0);
});

it("executes its entry point using the current working repository", async () => {
  const root = fixture({ "apps/stable.ts": "Tenant" });
  const argv = process.argv;
  const exitCode = process.exitCode;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(root);
  try {
    process.argv = [
      process.execPath,
      fileURLToPath(new URL("./rename-tenant.mjs", import.meta.url)),
      "--write",
    ];
    vi.resetModules();
    await import("./rename-tenant.mjs");
    expect(process.exitCode).toBe(0);
    expect(readFileSync(join(root, "apps/stable.ts"), "utf8")).toBe("Taxpayer");
    process.argv = [process.execPath];
    vi.resetModules();
    await import("./rename-tenant.mjs");
    expect(git(root, "status", "--porcelain")).toContain("apps/stable.ts");
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
  }
});

it("keeps the reviewed Madrid table map while renaming and reporting ordinary references beside it", () => {
  const mapping =
    'const renames = { tenants: "taxpayer", tenant_credentials: "venue_credentials" };';
  const source = `${mapping}\nconst row = db.select().from(tenants); readCredential(tenant_credentials);`;
  expect(renameText(source)).toBe(
    `${mapping}\nconst row = db.select().from(taxpayer); readCredential(venue_credentials);`,
  );
  expect(residuals("seed.madrid-baseline.test.ts", source)).toEqual([
    "seed.madrid-baseline.test.ts:2: const row = db.select().from(tenants); readCredential(tenant_credentials);",
  ]);
  expect(residuals("seed.madrid-baseline.test.ts", renameText(source))).toEqual([]);
});
