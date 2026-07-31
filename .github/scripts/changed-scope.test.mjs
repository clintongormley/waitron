import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCOPE_GATES,
  classify,
  formatOutput,
  gateOutputs,
  isInertPath,
  packagesInScope,
} from "./changed-scope.mjs";

describe("isInertPath", () => {
  it.each(["docs/backlog.md", "docs/superpowers/specs/some-design.md", "docs/compliance/x.md"])(
    "treats %s as inert",
    (path) => {
      expect(isInertPath(path)).toBe(true);
    },
  );

  it.each(["CLAUDE.md", "README.md", "CONTRIBUTING.md"])(
    "treats the root-level %s as inert",
    (path) => {
      expect(isInertPath(path)).toBe(true);
    },
  );

  // The case that rules out a `**/*.md` shortcut. packages/verifactu/schemas/README.md is a test
  // FIXTURE: schemas.test.ts:40-48 asserts each AEAT schema's SHA-256 appears in it, precisely to
  // catch someone editing a primary source to make a test pass. Classifying it as documentation
  // would let that edit skip the only test guarding it.
  it("treats packages/verifactu/schemas/README.md as code, not documentation", () => {
    expect(isInertPath("packages/verifactu/schemas/README.md")).toBe(false);
  });

  it.each([
    "packages/db/src/index.ts",
    "packages/db/README.md",
    "apps/server/README.md",
    ".github/workflows/ci.yml",
    ".husky/pre-push",
    "pnpm-workspace.yaml",
    "eslint.config.js",
    ".prettierignore",
  ])("treats %s as code", (path) => {
    expect(isInertPath(path)).toBe(false);
  });
});

describe("classify", () => {
  it("reports no code work when every path is inert", () => {
    expect(classify(["docs/backlog.md", "CLAUDE.md"]).code).toBe(false);
  });

  it("reports code work when a single path is not inert", () => {
    expect(classify(["docs/backlog.md", "CLAUDE.md", "packages/db/src/index.ts"]).code).toBe(true);
  });

  // Fails CLOSED, the same principle as the pre-push hook running the gate when stdin carries no
  // refs: an empty list means we could not work out what changed, not that nothing did.
  it("reports code work for an empty path list", () => {
    const result = classify([]);
    expect(result.code).toBe(true);
    expect(result.reason).toMatch(/no changed paths/i);
  });

  it("ignores blank lines, which a git diff pipe can produce", () => {
    expect(classify(["docs/backlog.md", "", "  "]).code).toBe(false);
  });

  it("explains itself by naming the first non-inert path", () => {
    expect(classify(["docs/a.md", "packages/db/src/index.ts"]).reason).toContain(
      "packages/db/src/index.ts",
    );
  });
});

const ls = (...names) => JSON.stringify(names.map((name) => ({ name })));

describe("packagesInScope", () => {
  it("reads the package names out of a pnpm ls result", () => {
    expect(packagesInScope(ls("@waitron/db", "@waitron/payments"))).toEqual(
      new Set(["@waitron/db", "@waitron/payments"]),
    );
  });

  it("reads an empty result as an empty scope, which means nothing matched", () => {
    expect(packagesInScope("")).toEqual(new Set());
    expect(packagesInScope("   ")).toEqual(new Set());
    expect(packagesInScope("[]")).toEqual(new Set());
  });

  // null is "we do not know", which gateOutputs turns into every gate running. Separate from the
  // empty set, which is the definite answer "nothing matched".
  it("returns null when the output cannot be parsed", () => {
    expect(packagesInScope("No projects matched the filters")).toBe(null);
  });
});

describe("gateOutputs", () => {
  /** The gate lines as an object, so a test can assert one gate without pinning the others' order. */
  const gates = (inScope) =>
    Object.fromEntries(
      gateOutputs(inScope)
        .split("\n")
        .map((line) => {
          const [name, value] = line.split("=");
          return [name, value];
        }),
    );

  it("emits one line per gate, in SCOPE_GATES order", () => {
    expect(gateOutputs(new Set()).split("\n")).toEqual(
      SCOPE_GATES.map((gate) => `${gate.output}=false`),
    );
  });

  // The three assertions the old needsHeavyShard carried, now expressed through the general path:
  // membership of the resolved scope, and nothing else, decides the heavy shard.
  it("runs the heavy shard when @waitron/db is in the resolved scope, and not otherwise", () => {
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).heavy).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/payments", "@waitron/server"))).heavy).toBe("false");
    expect(gates(packagesInScope("")).heavy).toBe("false");
  });

  it("runs mutation-verifactu only when @waitron/verifactu is in the resolved scope", () => {
    expect(gates(packagesInScope(ls("@waitron/verifactu"))).verifactu).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).verifactu).toBe("false");
  });

  it("runs mutation-shared only when @waitron/shared is in the resolved scope", () => {
    expect(gates(packagesInScope(ls("@waitron/shared"))).shared).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).shared).toBe("false");
  });

  // A package in scope must not switch on a gate belonging to a different package. Measured
  // dependency fact behind this: `pnpm --filter "@waitron/verifactu..." ls --depth -1` is
  // @waitron/verifactu alone, so verifactu changing pulls in its DEPENDENTS (fiscal-verifactu,
  // migrations, provisioning, server) and never @waitron/shared.
  it("keeps the gates independent of each other", () => {
    const scope = packagesInScope(
      ls("@waitron/verifactu", "@waitron/fiscal-verifactu", "@waitron/server"),
    );
    expect(gates(scope)).toEqual({ heavy: "false", verifactu: "true", shared: "false" });
  });

  // Fails CLOSED, in both of the two ways the caller can say "no narrowing applies": an unparseable
  // pnpm ls result (packagesInScope returned null) and an unscoped run on main, where there is no
  // scope to resolve at all. Running a job that was not needed costs runner time; skipping one that
  // was needed ships an untested package.
  it("runs every gate when the scope is unknown", () => {
    expect(gateOutputs(null).split("\n")).toEqual(SCOPE_GATES.map((gate) => `${gate.output}=true`));
    expect(gateOutputs(packagesInScope("No projects matched the filters"))).toBe(gateOutputs(null));
  });
});

describe("SCOPE_GATES", () => {
  it("names the three packages whose membership gates a job", () => {
    expect(SCOPE_GATES).toEqual([
      { output: "heavy", packageName: "@waitron/db" },
      { output: "verifactu", packageName: "@waitron/verifactu" },
      { output: "shared", packageName: "@waitron/shared" },
    ]);
  });
});

describe("formatOutput", () => {
  it("emits a GitHub Actions output line for a code change", () => {
    expect(formatOutput(["packages/db/src/index.ts"])).toBe("code=true");
  });

  it("emits a GitHub Actions output line for a docs change", () => {
    expect(formatOutput(["docs/backlog.md"])).toBe("code=false");
  });
});

// The CLI is only reachable by running the file, so these spawn it. What they add over the unit
// tests above is the part no exported function can show: WHICH STREAM each line goes to. The
// workflow appends this process's stdout straight to $GITHUB_OUTPUT, so a stray line there becomes
// a bogus job output — and the human-readable reason has to land on stderr for that to hold.
describe("the CLI", () => {
  const script = join(import.meta.dirname, "changed-scope.mjs");

  /** Runs the script with `input` on stdin, keeping its two streams apart. */
  const run = (input, ...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });
    expect(result.status).toBe(0);
    return result;
  };

  it("writes only the output line to stdout, for a docs-only diff", () => {
    expect(run("docs/backlog.md\nCLAUDE.md\n").stdout).toBe("code=false\n");
  });

  it("writes only the output line to stdout, for a diff touching a package", () => {
    expect(run("docs/backlog.md\npackages/db/src/index.ts\n").stdout).toBe("code=true\n");
  });

  // The all-zero `github.event.before` path: the workflow pipes an empty `paths` in, and the run
  // must fail closed to a full one rather than skipping everything.
  it("fails closed on empty stdin", () => {
    expect(run("").stdout).toBe("code=true\n");
    expect(run("\n").stdout).toBe("code=true\n");
  });

  // One `pnpm ls` invocation answers every gate. The `changes` job appends this stdout verbatim to
  // $GITHUB_OUTPUT, so the line ORDER does not matter to it but the line COUNT does — a fourth line
  // here would become a fourth job output.
  it("answers the gates subcommand from one pnpm ls result", () => {
    expect(run(ls("@waitron/db", "@waitron/shared"), "gates").stdout).toBe(
      "heavy=true\nverifactu=false\nshared=true\n",
    );
    expect(run(ls("@waitron/payments"), "gates").stdout).toBe(
      "heavy=false\nverifactu=false\nshared=false\n",
    );
  });

  // An empty match is what `pnpm ls --json` really emits when the filter selects nothing: zero
  // bytes on stdout, zero on stderr, exit 0 — not `[]`, and no message. Measured on pnpm 9.15.0
  // against `--filter "@waitron/nonexistent"`, `--filter "...[main]"` and
  // `--filter "...[origin/main]"`, in both a worktree and a fresh clone.
  it("reads an empty pnpm ls result as no work for any gated job", () => {
    expect(run("", "gates").stdout).toBe("heavy=false\nverifactu=false\nshared=false\n");
  });

  // main has no scope to resolve, so there is no `pnpm ls` to run. The flag keeps the gate list in
  // ONE place: adding a gate must not need a second edit in ci.yml, because forgetting that edit
  // would leave the new job never running on main — the silent direction.
  //
  // A resolved scope is fed in anyway, and must be ignored: that is what shows the flag decides on
  // its own rather than falling through to whatever happens to be on stdin.
  it("emits every gate for an unscoped run, ignoring stdin entirely", () => {
    expect(run(ls("@waitron/payments"), "gates", "--unscoped").stdout).toBe(
      "heavy=true\nverifactu=true\nshared=true\n",
    );
    expect(run("", "gates", "--unscoped").stdout).toBe("heavy=true\nverifactu=true\nshared=true\n");
  });

  it("fails closed to every gate when pnpm ls output cannot be parsed", () => {
    expect(run("No projects matched the filters", "gates").stdout).toBe(
      "heavy=true\nverifactu=true\nshared=true\n",
    );
  });

  it("puts the reason on stderr, where it cannot reach $GITHUB_OUTPUT", () => {
    const { stdout, stderr } = run("docs/backlog.md\n");
    expect(stderr).toContain("are documentation");
    expect(stdout).not.toContain("documentation");
  });
});
