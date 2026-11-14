import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reserved = new RegExp(
  `(?<![A-Za-z0-9_-])(?:${[...shields]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})(?![A-Za-z0-9_-])`,
  "g",
);
function shield(text) {
  const names = [];
  return [text.replace(reserved, (name) => `\0S${names.push(name) - 1}\0`), names];
}
export function renameText(text) {
  const [protectedText, names] = shield(text);
  let renamed = protectedText;
  for (const [from, to] of pairs) renamed = renamed.replaceAll(from, to);
  return renamed.replace(/\0S(\d+)\0/g, (_, index) => names[Number(index)]);
}
export const renamePath = renameText;
const excluded = [
  "**/drizzle/**",
  "packages/country-es/test-fixtures/**",
  "apps/server/src/testing/fixtures/configuration-v1-*.json",
  "packages/fiscal-verifactu/src/write-path.e2e.test.ts",
  "packages/fiscal-verifactu/src/inmutabilidad.test.ts",
  "scripts/no-tenant-column.test.ts",
  "scripts/a1308/**",
];
export function coveredFiles(paths) {
  return paths.filter(
    (path) =>
      /^(apps|packages|scripts)\//.test(path) &&
      !excluded.some((glob) => matchesGlob(path, glob)) &&
      !/\.(png|jpe?g|webp|gif|ico|pdf|woff2?|db|sqlite|p12|pfx)$/i.test(path),
  );
}
export function residuals(path, text) {
  return text
    .split("\n")
    .flatMap((line, index) =>
      /tenant/i.test(shield(line)[0]) ? [`${path}:${index + 1}: ${line}`] : [],
    );
}
export async function main(argv, root = process.cwd()) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  const files = coveredFiles(
    git("ls-files", "-z", "--", "apps", "packages", "scripts").split("\0").filter(Boolean),
  );
  let changes = 0;
  for (const path of files) {
    if (!lstatSync(resolve(root, path)).isFile()) continue;
    const text = readFileSync(resolve(root, path), "utf8");
    if (argv.includes("--report")) {
      for (const line of residuals(path, text)) {
        console.log(line);
        changes++;
      }
      continue;
    }
    const nextPath = renamePath(path);
    const nextText = renameText(text);
    if (nextPath === path && nextText === text) continue;
    changes++;
    console.log(nextPath === path ? path : `${path} -> ${nextPath}`);
    if (!argv.includes("--write")) continue;
    if (nextPath !== path) {
      mkdirSync(dirname(resolve(root, nextPath)), { recursive: true });
      git("mv", "--", path, nextPath);
    }
    writeFileSync(resolve(root, nextPath), nextText);
  }
  return argv.includes("--write") && !argv.includes("--report") ? 0 : Number(changes > 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
