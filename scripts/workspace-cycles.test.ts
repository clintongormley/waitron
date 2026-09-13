import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceMembers } from "./workspace-members.mjs";

/**
 * No workspace package may reach itself through other workspace packages. pnpm counts every
 * dependency kind when it looks for a loop, so a test-only (`devDependencies`) link closes one as
 * surely as a runtime link, and `pnpm install` prints "There are cyclic workspace dependencies".
 * A test that needs packages from both ends of such a loop belongs in a package nothing else
 * depends on — `packages/replication-tests` for the replication suites, whose node fixture lives in
 * `packages/provisioning/src/testing/replication-node.ts`.
 *
 * Reads each member's `package.json` rather than pnpm's own graph, and counts a dependency as a link
 * when its name is another workspace member, whatever its version range.
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
function dependencyLoops(graph: Graph): string[][] {
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

type Manifest = Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

/** Each member's dependency names, every field; `dependencyLoops` ignores names outside the graph. */
function graphFromManifests(members: { name: string; manifest: Manifest }[]): Graph {
  return new Map(
    members.map(({ name, manifest }) => [
      name,
      DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})),
    ]),
  );
}

function workspaceGraph(): Graph {
  return graphFromManifests(
    workspaceMembers().map(({ name, dir }) => ({
      name,
      manifest: JSON.parse(readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8")) as Manifest,
    })),
  );
}

describe("the workspace dependency graph", () => {
  it("has no loops, counting test-only dependencies", () => {
    const graph = workspaceGraph();
    expect(graph.size, "guards against a vacuous pass over an empty listing").toBeGreaterThan(10);
    expect(dependencyLoops(graph)).toEqual([]);
  }, 60_000);

  describe("the graph built from manifests", () => {
    it("links members through any version range, not only `workspace:`", () => {
      const graph = graphFromManifests([
        { name: "a", manifest: { dependencies: { b: "*" } } },
        { name: "b", manifest: { devDependencies: { a: "link:../a" } } },
      ]);
      expect(dependencyLoops(graph)).toEqual([["a", "b"]]);
    });
  });

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
