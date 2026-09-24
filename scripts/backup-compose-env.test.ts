import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `box-env.ts` lets a NON-empty environment value win over the wizard's `backup.env` and ignores
// an empty one, so a non-empty default here would silently disable a file-configured backup.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMPOSE = readFileSync(`${ROOT}deploy/compose.yml`, "utf8");

describe("compose backup vars cannot silently disable a file-configured backup", () => {
  it("every WAITRON_BACKUP_* compose var uses the empty-default shape the merge is proven to ignore", () => {
    const backupLines = COMPOSE.split("\n").filter((l) => /WAITRON_BACKUP_\w+:/.test(l));
    expect(backupLines.length).toBeGreaterThan(0);
    for (const line of backupLines) {
      expect(line).toMatch(/\$\{WAITRON_BACKUP_\w+:-\}\s*$/);
    }
  });
});
