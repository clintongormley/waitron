import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePackages } from "./changed-packages.mjs";

/**
 * No workspace package may reach itself through other workspace packages. pnpm counts every
 * dependency kind when it looks for a loop, so a test-only (`devDependencies`) link closes one as
 * surely as a runtime link, and `pnpm install` prints "There are cyclic workspace dependencies".
 * A test that needs packages from both ends of such a loop belongs in a package nothing else
 * depends on — `packages/replication-tests` for the replication suites.
 *
 * Reads each member's `package.json` rather than pnpm's own graph: a `workspace:` range is a
 * workspace link, and anything else is treated as an outside package.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type Graph = Map<string, string[]>;

/** Every group of two or more packages that reach one another, each group sorted by name. */
export function dependencyLoops(graph: Graph): string[][] {
  let counter = 0;
  const order = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const loops: string[][] = [];

  const visit = (name: string): void => {
    order.set(name, counter);
    lowest.set(name, counter);
    counter += 1;
    stack.push(name);
    onStack.add(name);
    for (const next of graph.get(name) ?? []) {
      if (!graph.has(next)) continue;
      if (!order.has(next)) {
        visit(next);
        lowest.set(name, Math.min(lowest.get(name)!, lowest.get(next)!));
      } else if (onStack.has(next)) {
        lowest.set(name, Math.min(lowest.get(name)!, order.get(next)!));
      }
    }
    if (lowest.get(name) !== order.get(name)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
    } while (member !== name);
    if (group.length > 1) loops.push(group.sort());
  };

  for (const name of graph.keys()) if (!order.has(name)) visit(name);
  return loops;
}

function workspaceGraph(): Graph {
  const args = ["ls", "-r", "--depth", "-1", "--json"];
  const result = spawnSync("pnpm", args, { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`\`pnpm ${args.join(" ")}\` exited ${result.status}: ${result.stderr}`);
  }
  const members = workspacePackages(result.stdout, REPO_ROOT);
  if (members === null) throw new Error("`pnpm ls` returned no parsable workspace listing");

  const graph: Graph = new Map();
  for (const { name, dir } of members) {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const links = DEPENDENCY_FIELDS.flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(([, range]) => range.startsWith("workspace:"))
        .map(([dependency]) => dependency),
    );
    graph.set(name, links);
  }
  return graph;
}

describe("the workspace dependency graph", () => {
  it("has no loops, counting test-only dependencies", () => {
    const graph = workspaceGraph();
    expect(graph.size, "guards against a vacuous pass over an empty listing").toBeGreaterThan(10);
    expect(dependencyLoops(graph)).toEqual([]);
  }, 60_000);

  describe("the loop detector itself", () => {
    const graphOf = (edges: Record<string, string[]>): Graph => new Map(Object.entries(edges));

    it("finds a two-package loop", () => {
      expect(dependencyLoops(graphOf({ a: ["b"], b: ["a"] }))).toEqual([["a", "b"]]);
    });

    it("finds every member of a longer loop, and nothing hanging off it", () => {
      const graph = graphOf({ a: ["b"], b: ["c"], c: ["a", "d"], d: [] });
      expect(dependencyLoops(graph)).toEqual([["a", "b", "c"]]);
    });

    it("does not call a diamond a loop", () => {
      const graph = graphOf({ top: ["left", "right"], left: ["base"], right: ["base"], base: [] });
      expect(dependencyLoops(graph)).toEqual([]);
    });

    it("ignores a link to a package outside the graph", () => {
      expect(dependencyLoops(graphOf({ a: ["outside"] }))).toEqual([]);
    });
  });
});
