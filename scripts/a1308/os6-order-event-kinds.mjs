import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const families = {
  Dish: ["moved", "cancelled"],
  Draft: ["created", "taken_over", "submitted", "discarded"],
  Group: ["submitted", "joined", "fired", "reordered", "lines_moved", "removed"],
};

export function renameOrderEvents(text) {
  for (const [family, kinds] of Object.entries(families)) {
    const table = `order${family === "Dish" ? "Portion" : family}Events`;
    const comparison = new RegExp(`(\\b${table}\\.kind,\\s*)("[^"]+"|\\[[^\\]]*\\])`, "g");
    const kind = new RegExp(`"(${kinds.join("|")})"`, "g");
    text = text
      .replace(
        comparison,
        (_, column, values) =>
          column + values.replace(kind, (_, name) => `"${family.toLowerCase()}.${name}"`),
      )
      .replace(new RegExp(`\\b${table}\\.createdAt\\b`, "g"), "orderEvents.at")
      .replace(new RegExp(`\\b${table}\\b`, "g"), "orderEvents");
  }
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "apps/server/src/*.test.ts", "packages/db/src/*.test.ts"],
    { encoding: "utf8" },
  );
  for (const file of files.split("\0").filter(Boolean)) {
    const before = readFileSync(file, "utf8");
    const after = renameOrderEvents(before);
    if (before !== after) writeFileSync(file, after);
  }
}
