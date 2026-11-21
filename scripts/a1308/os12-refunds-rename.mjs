import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";

const files = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--",
    "apps",
    "packages",
    "scripts",
    ":!**/drizzle/**",
    ":!packages/country-es/test-fixtures/**",
    ":!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts",
    ":!scripts/a1308/**",
  ],
  { encoding: "utf8" },
);

const tableNames = /\b(?:bill_payment_refunds|tender_refunds)(?=\W|_|$)/g;
const tableBindings = /\b(?:billPaymentRefunds|tenderRefunds)\b/g;
const stateBindings = /\b(?:billPaymentRefundState|tenderRefundState)\b/g;

for (const file of files.split("\0").filter((path) => /\.(?:ts|mjs|json|sql)$/.test(path))) {
  if (file.includes("/drizzle/") || !lstatSync(file).isFile()) continue;
  const before = readFileSync(file, "utf8");
  const aliasNeeded =
    /\b(?:const|let)\s+(?:refunds\b|\{[^}]*\brefunds\b[^}]*\})|\brefunds:\s*(?:readonly\s|\(typeof )/.test(
      before,
    );
  const alias = /function refundRows\b|\brefunds\s*=\s*\[/.test(before)
    ? "refundTable"
    : aliasNeeded
      ? "refundRows"
      : "refunds";
  const after = before
    .replace(/import(?:\s+type)?\s*\{[^{}]*\}\s*from\s*"[^"]+";/g, (statement) => {
      const seen = new Set();
      return statement.replace(
        /\b(?:billPaymentRefunds|tenderRefunds|billPaymentRefundState|tenderRefundState)\b(\s*,?\s*)/g,
        (match, gap) => {
          const binding = match.includes("State") ? "refundState" : alias;
          if (seen.has(binding)) return "";
          seen.add(binding);
          return (binding === alias && alias !== "refunds" ? `refunds as ${alias}` : binding) + gap;
        },
      );
    })
    .replaceAll("bill_payment_refunds_submission_key", "refunds_bill_submission_key")
    .replaceAll("tender_refunds_submission_key", "refunds_sale_submission_key")
    .replace(tableNames, "refunds")
    .replace(tableBindings, alias)
    .replace(stateBindings, "refundState")
    .replaceAll("/schema/tender-refunds.js", "/schema/refunds.js");
  if (after !== before) {
    writeFileSync(file, after);
    console.log(file);
  }
}
