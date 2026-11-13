import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function renameMerges(text) {
  for (const [from, to] of [
    ["floor_today_joins", "table_merges"],
    ["floorTodayJoins", "tableMerges"],
    ["floor_today_joins_zone_idx", "table_merges_zone_idx"],
    ["floor_today_joins_seats_ck", "table_merges_seats_ck"],
    ["floor_today_joins_zone_fk", "table_merges_zone_fk"],
  ])
    text = text.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  for (const path of execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)) {
    if (
      !/^(apps|packages|scripts)\/.*\.(ts|mjs|json)$/.test(path) ||
      path.includes("/drizzle/") ||
      path === "scripts/migration-baseline-epoch.json" ||
      path.startsWith("packages/country-es/test-fixtures/") ||
      path.startsWith("scripts/a1308/") ||
      path === "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts" ||
      !statSync(path).isFile()
    )
      continue;
    const before = readFileSync(path, "utf8");
    const after = renameMerges(before);
    if (after !== before) {
      writeFileSync(path, after);
      console.log(path);
    }
  }
}
