import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readDefaults, type WaitronDefaults } from "@waitron/ui-core/theme";

// In the workspace this resolves to packages/ui-core/src/tokens/; beside the bundle, to the copy
// copy-migrations.mjs puts in dist/node_modules/@waitron/ui-core/ (/app/node_modules/ in the image).
export function readTokenFile(name: "colors.css" | "structure.css"): string {
  return readFileSync(
    fileURLToPath(import.meta.resolve(`@waitron/ui-core/tokens/${name}`)),
    "utf8",
  );
}

export const SERVER_THEME_DEFAULTS: WaitronDefaults = readDefaults(
  readTokenFile("colors.css"),
  readTokenFile("structure.css"),
);
