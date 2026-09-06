import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_PACKAGE,
  FISCAL_VERIFACTU_PACKAGE,
  HEAVY_PACKAGE,
  PACKAGES_WITHOUT_TESTS,
  SCOPE_GATES,
  SERVER_PACKAGE,
  SETUP_PACKAGE,
  TILL_PACKAGE,
  UI_PACKAGE,
  classify,
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

  // Root config no gate reads. A push touching only these ran the whole workspace, locally and in
  // CI, until 2026-09-06.
  it.each([".codex/config.toml", ".vscode/settings.json", ".gitignore", ".editorconfig"])(
    "treats the root config %s as inert",
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
    "pnpm-lock.yaml",
    "eslint.config.js",
    ".prettierignore",
  ])("treats %s as code", (path) => {
    expect(isInertPath(path)).toBe(false);
  });

  // The root-config rule is ROOT-ONLY: the same names inside a package are that package's files,
  // and a package's `.gitignore` decides what its build and test runs can see.
  it.each(["packages/db/.gitignore", "apps/till/.vscode/x.json"])(
    "treats %s as code, because the root-config rule does not reach inside a package",
    (path) => {
      expect(isInertPath(path)).toBe(false);
    },
  );
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

  // `pnpm ls --json` reports its OWN failures as valid JSON on stdout — this is the literal shape
  // of `pnpm --filter "" ls --json` on pnpm 9.15.0. It parses, so only the array-shape check tells
  // it apart from a real result, and `null` (not the empty set) is what makes gateOutputs run
  // everything rather than skip everything.
  it("returns null for pnpm's own error object, which is valid JSON", () => {
    const pnpmError = '{"error":{"code":"pnpm","message":"Unsupported package selector: …"}}';
    expect(packagesInScope(pnpmError)).toBeNull();
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

  // The `ui` gate exists for the same reason as `heavy`: @waitron/ui has a shard of its own, so
  // test-light subtracts it and something has to decide whether test-ui runs. Membership of the
  // resolved scope, exactly as heavy is decided.
  it("runs the ui shard when @waitron/ui is in the resolved scope, and not otherwise", () => {
    expect(gates(packagesInScope(ls("@waitron/ui", "@waitron/payments"))).ui).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).ui).toBe("false");
    expect(gates(packagesInScope("")).ui).toBe("false");
  });

  // The `till` gate exists for the same reason as `ui`: @waitron/till is the second Chromium
  // browser package, has a shard of its own, so test-light subtracts it and something has to decide
  // whether test-till runs. Membership of the resolved scope, exactly as ui is decided.
  it("runs the till shard when @waitron/till is in the resolved scope, and not otherwise", () => {
    expect(gates(packagesInScope(ls("@waitron/till", "@waitron/payments"))).till).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).till).toBe("false");
    expect(gates(packagesInScope("")).till).toBe("false");
  });

  // The `dashboard` gate exists for the same reason as `till`: @waitron/dashboard is the third
  // Chromium browser package, has a shard of its own, so test-light subtracts it and something has
  // to decide whether test-dashboard runs. Membership of the resolved scope, exactly as till is
  // decided.
  it("runs the dashboard shard when @waitron/dashboard is in the resolved scope, and not otherwise", () => {
    expect(gates(packagesInScope(ls("@waitron/dashboard", "@waitron/payments"))).dashboard).toBe(
      "true",
    );
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).dashboard).toBe("false");
    expect(gates(packagesInScope("")).dashboard).toBe("false");
  });

  // The `server` gate exists for the same reason as `heavy`: apps/server has a shard of its own
  // (test-server, split out on a measurement — 341.7s of test-light's 358s), so test-light subtracts
  // it and something has to decide whether test-server runs. Membership of the resolved scope,
  // exactly as heavy is decided.
  it("runs the server shard when @waitron/server is in the resolved scope, and not otherwise", () => {
    expect(gates(packagesInScope(ls("@waitron/server", "@waitron/payments"))).server).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/payments"))).server).toBe("false");
    expect(gates(packagesInScope("")).server).toBe("false");
  });

  // The `fiscal_verifactu` gate exists for the same reason as `heavy`: packages/fiscal-verifactu has
  // a shard of its own (test-fiscal-verifactu, isolated because it is the one maxForks:4 suite), so
  // both light shards subtract it and something has to decide whether test-fiscal-verifactu runs.
  // NOT the `verifactu` gate below, which is the mutation run over the separate packages/verifactu.
  it("runs the fiscal-verifactu shard when @waitron/fiscal-verifactu is in scope, and not otherwise", () => {
    expect(
      gates(packagesInScope(ls("@waitron/fiscal-verifactu", "@waitron/db"))).fiscal_verifactu,
    ).toBe("true");
    expect(gates(packagesInScope(ls("@waitron/db", "@waitron/core"))).fiscal_verifactu).toBe(
      "false",
    );
    expect(gates(packagesInScope("")).fiscal_verifactu).toBe("false");
  });

  // light_a and light_b are the two gates that are NOT membership of a named package: each fires
  // when the resolved scope holds a package in its bin (LIGHT_A_PACKAGES / LIGHT_B_PACKAGES) that
  // declares tests. @waitron/core is in bin A, @waitron/identity in bin B.
  //
  // What made a light gate worth having, read off run 30653487133 with
  // `gh run view 30653487133 --json jobs`: gated on `code` alone, the single old test-light was that
  // run's longest job — 18:01:36 → 18:02:24, 48s — and its step printed `None of the selected
  // packages has a "test:coverage" script`. A runner and a `pnpm install` for zero test execution,
  // reported as success — now prevented once per half.
  it("runs light_a for a bin-A package and light_b for a bin-B package", () => {
    const a = gates(packagesInScope(ls("@waitron/core")));
    expect(a.light_a).toBe("true");
    expect(a.light_b).toBe("false");

    const b = gates(packagesInScope(ls("@waitron/identity")));
    expect(b.light_a).toBe("false");
    expect(b.light_b).toBe("true");

    // A scope spanning both bins runs both, and an own-shard package alongside a bin package does
    // not suppress that bin's gate.
    const both = gates(packagesInScope(ls("@waitron/core", "@waitron/identity", "@waitron/db")));
    expect(both.light_a).toBe("true");
    expect(both.light_b).toBe("true");
  });

  // The rows that separate a light gate from a membership gate in the other direction: the package
  // IS in scope, and both light shards still have nothing to do, because each subtracts every
  // package that has a shard of its own.
  it.each([
    ["@waitron/db", ["@waitron/db"]],
    ["@waitron/ui", ["@waitron/ui"]],
    ["@waitron/till", ["@waitron/till"]],
    ["@waitron/dashboard", ["@waitron/dashboard"]],
    ["@waitron/setup", ["@waitron/setup"]],
    ["@waitron/server", ["@waitron/server"]],
    ["@waitron/fiscal-verifactu", ["@waitron/fiscal-verifactu"]],
    [
      "every package that has its own shard",
      [
        "@waitron/db",
        "@waitron/ui",
        "@waitron/till",
        "@waitron/dashboard",
        "@waitron/setup",
        "@waitron/server",
        "@waitron/fiscal-verifactu",
      ],
    ],
  ])("skips both light shards when the whole scope is %s", (_label, names) => {
    const g = gates(packagesInScope(ls(...names)));
    expect(g.light_a).toBe("false");
    expect(g.light_b).toBe("false");
  });

  it("skips both light shards for a scope that matched nothing", () => {
    for (const empty of ["", "[]"]) {
      const g = gates(packagesInScope(empty));
      expect(g.light_a).toBe("false");
      expect(g.light_b).toBe("false");
    }
  });

  // A package with no `test:coverage` script gives its light shard nothing to do — it is subtracted
  // by pnpm rather than by a filter, but the shard is just as empty. @waitron/bench-pglite is in bin
  // B, so this also proves the testless one does not switch light_b on by itself. Measured on
  // 2026-08-01: `pnpm --filter "...@waitron/bench-pglite" test:coverage` prints `None of the selected
  // packages has a "test:coverage" script` and exits 0.
  it("does not switch a light gate on when its bin's only in-scope package declares no tests", () => {
    const g = gates(packagesInScope(ls(...PACKAGES_WITHOUT_TESTS)));
    expect(g.light_a).toBe("false");
    expect(g.light_b).toBe("false");
  });

  it("runs a light gate when a testful package joins a test-less one in the SAME bin", () => {
    // @waitron/bench-pglite (no tests) and @waitron/identity both live in bin B: the testless one
    // must not suppress the testful one.
    const g = gates(packagesInScope(ls(...PACKAGES_WITHOUT_TESTS, "@waitron/identity")));
    expect(g.light_a).toBe("false");
    expect(g.light_b).toBe("true");
  });

  // Fails closed like every other gate, and centrally: gateOutputs applies the `inScope === null`
  // check before any gate's predicate is called, so a gate cannot forget it. Asserted on the light
  // gates by name rather than only through the SCOPE_GATES-wide test below, which would keep passing
  // if a gate were removed from the list entirely.
  it("runs both light shards when the scope is unknown", () => {
    for (const unknown of [null, packagesInScope("No projects matched the filters")]) {
      const g = gates(unknown);
      expect(g.light_a).toBe("true");
      expect(g.light_b).toBe("true");
    }
  });

  // A package with its own single-package shard is subtracted by BOTH light shards, so it switches
  // its own gate on and neither light gate: the dedicated shards and the light shards cannot drift
  // into covering one package twice or neither. scripts/ci-workflow.test.mjs checks the other half
  // of that, against ci.yml's real filters and the real workspace.
  it.each([
    ["heavy", HEAVY_PACKAGE],
    ["ui", UI_PACKAGE],
    ["till", TILL_PACKAGE],
    ["dashboard", DASHBOARD_PACKAGE],
    ["setup", SETUP_PACKAGE],
    ["server", SERVER_PACKAGE],
    ["fiscal_verifactu", FISCAL_VERIFACTU_PACKAGE],
  ])(
    "gives a package with its own shard to the %s gate alone, never to a light gate",
    (gate, name) => {
      // toEqual, not toMatchObject: a key you do not list is never checked at all (CLAUDE.md §4), and
      // this assertion's whole point is that ONE gate fires on this scope.
      expect(gates(packagesInScope(ls(name)))).toEqual({
        heavy: "false",
        ui: "false",
        till: "false",
        dashboard: "false",
        setup: "false",
        server: "false",
        fiscal_verifactu: "false",
        light_a: "false",
        light_b: "false",
        verifactu: "false",
        shared: "false",
        [gate]: "true",
      });
    },
  );

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
    // @waitron/fiscal-verifactu now has its own shard, so it switches `fiscal_verifactu` and neither
    // light gate; @waitron/verifactu is in bin B, so it switches light_b AND the `verifactu` mutation
    // gate (one package can legitimately switch on both); @waitron/server switches only `server`.
    expect(gates(scope)).toEqual({
      heavy: "false",
      ui: "false",
      till: "false",
      dashboard: "false",
      setup: "false",
      server: "true",
      fiscal_verifactu: "true",
      light_a: "false",
      light_b: "true",
      verifactu: "true",
      shared: "false",
    });
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

// The exemption list is the one piece of this module that is a claim about the TREE rather than a
// rule about a scope, so it is checked against the real workspace instead of against a fixture.
// Both directions matter and both are one `pnpm ls` away: a stale entry silently weakens the guard
// in scripts/changed-packages.mjs, and a missing one makes a shard that ran nothing fail for a
// package whose author never meant to declare tests.
//
// This is the enforcement docs/backlog.md asked for ("nothing enforces a future member declaring
// one"), and it lands in the ungated `lint` job, so it answers on the pull request rather than on
// the `main` merge that follows it.
describe("PACKAGES_WITHOUT_TESTS", () => {
  const repoRoot = join(import.meta.dirname, "..");

  /** Every workspace member (never the root), as `{name, declares}`. */
  const members = () => {
    const ls = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(ls.status).toBe(0);

    return JSON.parse(ls.stdout)
      .filter((pkg) => resolve(pkg.path) !== resolve(repoRoot))
      .map((pkg) => ({
        name: pkg.name,
        declares:
          JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8")).scripts?.[
            "test:coverage"
          ] !== undefined,
      }));
  };

  it("lists exactly the workspace members that declare no test:coverage script", () => {
    expect(
      members()
        .filter((member) => !member.declares)
        .map((member) => member.name)
        .sort(),
    ).toEqual([...PACKAGES_WITHOUT_TESTS].sort());
  });
});

describe("SCOPE_GATES", () => {
  // The gate NAMES are the interface: ci.yml declares one `changes` output per entry and each gated
  // job reads one by name, and the `--unscoped` path emits this list verbatim. What each gate MEANS
  // is asserted through gateOutputs above rather than by comparing predicate functions here.
  it("lists every gate, in the order the CLI emits them", () => {
    expect(SCOPE_GATES.map((gate) => gate.output)).toEqual([
      "heavy",
      "ui",
      "till",
      "dashboard",
      "setup",
      "server",
      "fiscal_verifactu",
      "light_a",
      "light_b",
      "verifactu",
      "shared",
    ]);
  });

  it("gives every gate a predicate over the resolved scope", () => {
    for (const gate of SCOPE_GATES) expect(typeof gate.covers).toBe("function");
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

  // One `pnpm ls` invocation answers every gate. The `changes` job appends this stdout verbatim to
  // $GITHUB_OUTPUT, so the line ORDER does not matter to it but the line COUNT does — a twelfth
  // line here would become a twelfth job output, and ci.yml declares exactly eleven.
  it("answers every gate from one pnpm ls result", () => {
    expect(run(ls("@waitron/db", "@waitron/shared")).stdout).toBe(
      "heavy=true\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=true\nlight_b=false\nverifactu=false\nshared=true\n",
    );
    expect(run(ls("@waitron/payments")).stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=true\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  // The whole point of the light gates, through the CLI: a scope that is one package with a shard of
  // its own and nothing else leaves both light shards with no package to run, because each subtracts
  // that package.
  it("reports no light work for a scope that is only @waitron/db", () => {
    expect(run(ls("@waitron/db")).stdout).toBe(
      "heavy=true\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  it("reports no light work for a scope that is only @waitron/ui", () => {
    expect(run(ls("@waitron/ui")).stdout).toBe(
      "heavy=false\nui=true\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  it("reports no light work for a scope that is only @waitron/till", () => {
    expect(run(ls("@waitron/till")).stdout).toBe(
      "heavy=false\nui=false\ntill=true\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  it("reports no light work for a scope that is only @waitron/dashboard", () => {
    expect(run(ls("@waitron/dashboard")).stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=true\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  // apps/setup is the fourth Chromium browser package, with its own shard (test-setup), so a scope of
  // only @waitron/setup switches `setup` and leaves both light shards empty — each subtracts it.
  it("reports no light work for a scope that is only @waitron/setup", () => {
    expect(run(ls("@waitron/setup")).stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=true\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  // apps/server has its own shard exactly as @waitron/db does, so a scope of only @waitron/server
  // leaves both light shards with nothing: test-server runs, and each light shard's own
  // `--filter "!@waitron/server"` subtracts it. This is the CLI half of the split's light-side receipt.
  it("reports no light work for a scope that is only @waitron/server", () => {
    expect(run(ls("@waitron/server")).stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=true\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  // packages/fiscal-verifactu likewise has its own shard (test-fiscal-verifactu), so a scope of only
  // it switches `fiscal_verifactu` and leaves both light shards empty — and does NOT switch the
  // `verifactu` mutation gate, which belongs to the separate packages/verifactu.
  it("reports fiscal_verifactu work but no light work for a scope that is only @waitron/fiscal-verifactu", () => {
    expect(run(ls("@waitron/fiscal-verifactu")).stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=true\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  // An empty match is what `pnpm ls --json` really emits when the filter selects nothing: zero
  // bytes on stdout, zero on stderr, exit 0 — not `[]`, and no message. Measured on pnpm 9.15.0
  // against `--filter "@waitron/nonexistent"`, `--filter "...[main]"` and
  // `--filter "...[origin/main]"`, in both a worktree and a fresh clone.
  it("reads an empty pnpm ls result as no work for any gated job", () => {
    expect(run("").stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  // main has no scope to resolve, so there is no `pnpm ls` to run. The flag keeps the gate list in
  // ONE place: adding a gate must not need a second edit in ci.yml, because forgetting that edit
  // would leave the new job never running on main — the silent direction.
  //
  // A resolved scope is fed in anyway, and must be ignored: that is what shows the flag decides on
  // its own rather than falling through to whatever happens to be on stdin.
  it("emits every gate for an unscoped run, ignoring stdin entirely", () => {
    expect(run(ls("@waitron/payments"), "--unscoped").stdout).toBe(
      "heavy=true\nui=true\ntill=true\ndashboard=true\nsetup=true\nserver=true\nfiscal_verifactu=true\nlight_a=true\nlight_b=true\nverifactu=true\nshared=true\n",
    );
    expect(run("", "--unscoped").stdout).toBe(
      "heavy=true\nui=true\ntill=true\ndashboard=true\nsetup=true\nserver=true\nfiscal_verifactu=true\nlight_a=true\nlight_b=true\nverifactu=true\nshared=true\n",
    );
  });

  it("fails closed to every gate when pnpm ls output cannot be parsed", () => {
    expect(run("No projects matched the filters").stdout).toBe(
      "heavy=true\nui=true\ntill=true\ndashboard=true\nsetup=true\nserver=true\nfiscal_verifactu=true\nlight_a=true\nlight_b=true\nverifactu=true\nshared=true\n",
    );
  });

  // `pnpm ls --json` reports its own failures as valid JSON on STDOUT, not as a diagnostic on
  // stderr — this is the literal shape of `pnpm --filter "" ls --json` on pnpm 9.15.0. It parses
  // cleanly, so only the array-shape check distinguishes it from a real result. Getting this wrong
  // means a pnpm failure reads as "no packages in scope" and every gated job skips, which is the
  // silent direction: `packages/db` and both mutation runs would be reported green having run
  // nothing. Raised by Copilot on PR #27 as a stderr-discarding concern; the mechanism turned out
  // to be different, but the untested path was real.
  it("fails closed when pnpm reports its own error as JSON on stdout", () => {
    const pnpmError = '{"error":{"code":"pnpm","message":"Unsupported package selector: …"}}';
    expect(run(pnpmError).stdout).toBe(
      "heavy=true\nui=true\ntill=true\ndashboard=true\nsetup=true\nserver=true\nfiscal_verifactu=true\nlight_a=true\nlight_b=true\nverifactu=true\nshared=true\n",
    );
  });

  it("treats a genuinely empty scope as empty, not as an error", () => {
    // `pnpm ls` emits zero bytes and exits 0 when its filter matches nothing, so this is the
    // ordinary "this change touches no package" case and must SKIP rather than run everything.
    expect(run("[]").stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
    expect(run("").stdout).toBe(
      "heavy=false\nui=false\ntill=false\ndashboard=false\nsetup=false\nserver=false\nfiscal_verifactu=false\nlight_a=false\nlight_b=false\nverifactu=false\nshared=false\n",
    );
  });

  it("puts the reason on stderr, where it cannot reach $GITHUB_OUTPUT", () => {
    const { stdout, stderr } = run(ls("@waitron/db"));
    expect(stderr).toContain("changed-scope:");
    expect(stdout).not.toContain("changed-scope:");
  });
});
