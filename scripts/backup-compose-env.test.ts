import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Documents Blocker 1 of the backup wizard (spec 2026-09-09-backup-recovery-key-wizard-design.md
 * §3.2): compose passes the `WAITRON_BACKUP_*` vars as `${VAR:-}` → "" in the container, and
 * `box-env.ts` merges the real environment over the box's files. `box-env.test.ts` proves an empty
 * base value no longer masks `backup.env`, so those empty defaults are inert — but a future compose
 * edit that reintroduced a NON-empty hard-coded default WOULD win over the wizard's file and
 * silently disable a file-configured backup. This guard is a regex pin over the compose text (no
 * YAML dependency, no cross-project import — the behavioural half lives in box-env.test.ts) that
 * makes such an edit fail loudly.
 *
 * Lives in the ROOT project (CLAUDE.md §4): it pins a file under `deploy/`, and a package-resident
 * guard only runs when its package is in scope.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMPOSE = readFileSync(`${ROOT}deploy/compose.yml`, "utf8");

describe("compose backup vars cannot silently disable a file-configured backup", () => {
  it("every WAITRON_BACKUP_* compose var uses the empty-default shape the merge is proven to ignore", () => {
    const backupLines = COMPOSE.split("\n").filter((l) => /WAITRON_BACKUP_\w+:/.test(l));
    expect(backupLines.length).toBeGreaterThan(0);
    for (const line of backupLines) {
      expect(line).toMatch(/\$\{WAITRON_BACKUP_\w+:-\}\s*$/); // empty default only
    }
  });
});
