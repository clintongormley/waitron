// Every package that can be mutation-tested declares the score it FAILS at.
//
// The owner set 90 for every package on 2026-09-19. Four packages carry it in their own
// `stryker.config.json`; `packages/db` cannot, because CI splits its run across ten shards and a
// `thresholds.break` there would gate each shard's slice rather than the package — so it is gated
// once, on the merged score, by the `mutation-db-aggregate` job. Both shapes are checked here, so a
// package that gains a `mutation` script without a bar, or a bar that quietly drops below 90, fails
// the build instead of publishing a score nobody reads.
//
// Weaker than its name in one way worth stating: it reads the workflow as TEXT for db's bar, so a
// step that reached the same command through a variable would be invisible to it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BAR = 90;

/** Every workspace package whose `package.json` declares a `mutation` script, as directory names. */
function mutationPackages() {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const manifest = join(root, "packages", entry.name, "package.json");
      try {
        return readFileSync(manifest, "utf8").includes('"mutation"');
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

describe("every mutation-tested package declares the bar it fails at", () => {
  it("finds the packages that run mutation testing", () => {
    // The list is read, not written down, so a new one arrives here on its own. It is asserted
    // non-empty because an empty list would make every case below vacuous.
    expect(mutationPackages().length).toBeGreaterThan(0);
  });

  it.each(mutationPackages().filter((name) => name !== "db"))(
    "packages/%s breaks at 90 in its own stryker config",
    (name) => {
      const config = JSON.parse(
        readFileSync(join(root, "packages", name, "stryker.config.json"), "utf8"),
      );
      expect(config.thresholds?.break).toBeGreaterThanOrEqual(BAR);
    },
  );

  it("packages/db breaks at 90 on the merged score of its shards", () => {
    // Its own config deliberately carries no `thresholds.break`: CI passes each shard its own
    // `--mutate` list, so a break there would gate a slice. The aggregate job is where its bar
    // lives.
    const config = JSON.parse(
      readFileSync(join(root, "packages", "db", "stryker.config.json"), "utf8"),
    );
    expect(config.thresholds).toBeUndefined();

    const workflow = readFileSync(join(root, ".github", "workflows", "mutation.yml"), "utf8");
    expect(workflow).toContain(
      `node scripts/mutation-aggregate.mjs mutation-reports --shards 10 --break ${BAR}`,
    );
  });
});
