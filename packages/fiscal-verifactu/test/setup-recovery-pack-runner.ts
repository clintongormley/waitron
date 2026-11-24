import { readFile } from "node:fs/promises";
import { loadRecoveryPackFonts } from "../src/recovery-pdf-node.js";
import { renderSetupRecoveryPack } from "../src/setup-recovery-pack.js";

const document = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const locale = process.argv[3] as "en" | "es";
process.stdout.write(
  await renderSetupRecoveryPack(
    document,
    { masterKey: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5", masterKeyName: "2026-11-23 · QZJV" },
    locale,
    process.argv[4]!,
    loadRecoveryPackFonts,
  ),
);
