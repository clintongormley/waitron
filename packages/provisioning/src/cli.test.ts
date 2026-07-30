import { describe, expect, it, vi } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import type { InstanceState, RoleFacts } from "./instance-state.js";

const DATABASE = "waitron_demo";
const ADMIN_URI = "postgres://admin:adminsecret@db.example:5432/postgres";

function facts(overrides: Partial<RoleFacts> = {}): RoleFacts {
  return {
    canLogin: true,
    createRole: false,
    superuser: false,
    bypassRls: false,
    memberOf: ["app_user"],
    ...overrides,
  };
}

function stateOf(overrides: Partial<InstanceState> = {}): InstanceState {
  return { database: DATABASE, databaseExists: false, roles: {}, inside: null, ...overrides };
}

/** Nothing exists: no database, no roles. The first-provision case. */
const BLANK = stateOf();

/** Everything exists and agrees. `migratedSets` is built from the manifest rather than spelled
 * out, so adding a migration package does not silently reintroduce a `migrate` action here. */
const PROVISIONED = stateOf({
  databaseExists: true,
  roles: {
    waitron_migrator: facts({ createRole: true }),
    waitron_app: facts(),
    waitron_provisioner: facts({ memberOf: ["app_user", "tenant_provisioner"] }),
  },
  inside: { migratedSets: manifestSets().map((set) => set.name), stamp: "preproduction" },
});

interface Harness {
  deps: CliDeps;
  /** Everything written to either stream, in order. */
  lines: string[];
  /** Only the ECHOED prompts — what an operator was asked out loud. */
  asked: string[];
  /** Only the echo-OFF prompts. */
  askedSecretly: string[];
  cleared: () => number;
  apply: ReturnType<typeof vi.fn>;
  readState: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  closes: () => number;
}

function harness(
  options: {
    answers?: string[];
    secrets?: string[];
    env?: Record<string, string | undefined>;
    state?: InstanceState;
    apply?: CliDeps["apply"];
    readState?: () => Promise<InstanceState>;
  } = {},
): Harness {
  const lines: string[] = [];
  const asked: string[] = [];
  const askedSecretly: string[] = [];
  const answers = [...(options.answers ?? [])];
  const secrets = [...(options.secrets ?? [ADMIN_URI])];
  let cleared = 0;
  let closes = 0;

  const db = { close: async () => void (closes += 1) } as unknown as Database;
  const connect = vi.fn(async () => db);
  const readState = vi.fn(options.readState ?? (async () => options.state ?? BLANK));
  const apply = vi.fn(options.apply ?? (async () => {}));

  return {
    lines,
    asked,
    askedSecretly,
    cleared: () => cleared,
    closes: () => closes,
    apply,
    readState,
    connect,
    deps: {
      io: {
        stdout: (line) => void lines.push(line),
        stderr: (line) => void lines.push(line),
        prompt: async (question) => {
          asked.push(question);
          return answers.shift() ?? "";
        },
        promptSecret: async (question) => {
          askedSecretly.push(question);
          return secrets.shift() ?? "";
        },
        clearScreen: () => void (cleared += 1),
      },
      env: options.env ?? {},
      connect: connect as unknown as CliDeps["connect"],
      migrationsRoot: null,
      readState: readState as unknown as CliDeps["readState"],
      apply: apply as unknown as CliDeps["apply"],
    },
  };
}

/** Every `postgres://` URI printed, in order. */
function printedUris(lines: string[]): string[] {
  return lines.join("\n").match(/postgres:\/\/\S+/g) ?? [];
}

describe("runCli", () => {
  it("prints usage and exits 2 for an unknown command", async () => {
    const h = harness();
    expect(await runCli(["frobnicate"], h.deps)).toBe(2);
    expect(h.lines.join("\n")).toContain("usage: waitron-provision");
  });

  it("prints usage and exits 2 when no command is given at all", async () => {
    const h = harness();
    expect(await runCli([], h.deps)).toBe(2);
    expect(h.lines.join("\n")).toContain("usage: waitron-provision");
  });

  it("refuses any flag that would put a secret in argv", async () => {
    // `strict: true` in the parser is what makes this a parse error rather than a silently ignored
    // flag. If a future maintainer adds --password or --key, this test goes red — which is the
    // point. Same guard packages/credentials/src/cli.test.ts makes.
    //
    // The `=` form matters and the two-token form does not carry the argument on its own: node:util
    // treats an UNRECOGNIZED `--flag value` as a boolean flag followed by a stray POSITIONAL, which
    // `allowPositionals: false` rejects independently of `strict`. `--flag=value` binds the value to
    // the flag regardless of whether the flag is known, so `strict: true` is the only thing
    // standing between it and an accepted secret.
    for (const flag of ["--password", "--key", "--admin-password"]) {
      for (const command of ["instance", "status"]) {
        expect(await runCli([command, flag, "hunter2"], harness().deps)).toBe(2);
        expect(await runCli([command, `${flag}=hunter2`], harness().deps)).toBe(2);
      }
    }
  });

  it("refuses --admin-url as a flag, in both argv forms", async () => {
    // The admin connection string carries a password, so it is NOT an option — it comes from
    // WAITRON_ADMIN_DATABASE_URL or an echo-off prompt and from nowhere else. Pinned separately
    // from the loop above because `--admin-url` is the one an operator is most likely to try:
    // earlier drafts of this tool's own usage text advertised it.
    for (const command of ["instance", "status"]) {
      const h = harness();
      expect(await runCli([command, "--admin-url", ADMIN_URI], h.deps)).toBe(2);
      expect(h.connect).not.toHaveBeenCalled();

      const g = harness();
      expect(await runCli([command, `--admin-url=${ADMIN_URI}`], g.deps)).toBe(2);
      expect(g.connect).not.toHaveBeenCalled();
    }
  });

  it("rejects a stray positional after the command", async () => {
    const h = harness();
    expect(await runCli(["status", "waitron_demo"], h.deps)).toBe(2);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("keyring needs no database and no admin connection", async () => {
    const h = harness();
    expect(await runCli(["keyring"], h.deps)).toBe(0);
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.readState).not.toHaveBeenCalled();
    expect(h.lines.join("\n")).toContain("WAITRON_CREDENTIALS_KEY=");
  });

  it("prompts for what a flag did not supply", async () => {
    const h = harness({
      answers: [DATABASE, "n"],
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    await runCli(["instance", "--environment", "preproduction"], h.deps);
    // --database was not supplied, so it is asked for; --environment was, so it is not.
    expect(h.asked.join(" ")).toMatch(/database/i);
    expect(h.asked.join(" ")).not.toMatch(/environment/i);
  });

  it("reads the admin connection string from the environment rather than asking", async () => {
    const h = harness({
      answers: ["n"],
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    expect(h.askedSecretly).toEqual([]);
    expect(h.connect).toHaveBeenCalledWith(ADMIN_URI);
  });

  it("asks for the admin connection string with the echo off when nothing supplied it", async () => {
    const h = harness({ answers: ["n"], secrets: [ADMIN_URI] });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    // Read through `promptSecret`, never `prompt`: the difference is whether it appears on screen.
    expect(h.askedSecretly).toHaveLength(1);
    expect(h.asked.join(" ")).not.toContain("connection");
    expect(h.connect).toHaveBeenCalledWith(ADMIN_URI);
  });

  it("never echoes the admin connection string back, from either source", async () => {
    for (const h of [
      harness({ answers: ["n"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } }),
      harness({ answers: ["n"], secrets: [ADMIN_URI] }),
    ]) {
      await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
      expect(h.lines.join("\n")).not.toContain("adminsecret");
    }
  });
});

describe("runCli instance", () => {
  it("prints a plan summary and applies NOTHING when the operator declines", async () => {
    const h = harness({ answers: ["n"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction"],
      h.deps,
    );

    const printed = h.lines.join("\n");
    expect(printed).toContain(`create database ${DATABASE}`);
    expect(printed).toContain("waitron_migrator");
    expect(printed).toContain("preproduction");
    // The assertion that matters is that nothing was WRITTEN, not merely that the code was
    // non-zero: a version that applied the plan and then returned 1 would pass an exit-code-only
    // test while having created a database.
    expect(h.apply).not.toHaveBeenCalled();
    expect(code).not.toBe(0);
  });

  it("never puts a generated password in the plan summary", async () => {
    // Written as "appears exactly once in the whole transcript" rather than "does not appear in
    // these lines", because the passwords are generated inside `planInstance` and this test cannot
    // know them in advance. The connection strings at the END are the one legitimate occurrence,
    // so a count of one per password proves the summary above them carried none.
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(0);

    const transcript = h.lines.join("\n");
    const uris = printedUris(h.lines);
    expect(uris).toHaveLength(3);
    for (const uri of uris) {
      const password = new URL(uri).password;
      expect(password).not.toBe("");
      expect(transcript.split(password)).toHaveLength(2);
    }
  });

  it("--yes applies without asking for confirmation", async () => {
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(0);
    expect(h.apply).toHaveBeenCalledTimes(1);
    // The acknowledgement of the printed connection strings is NOT the plan confirmation, and
    // --yes does not skip it: three passwords are about to be wiped off the screen.
    expect(h.asked.join(" ")).not.toMatch(/apply/i);
  });

  it("applies when the operator answers y", async () => {
    const h = harness({ answers: ["y"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(
      await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps),
    ).toBe(0);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("prints each created role's connection string once, then clears the screen", async () => {
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
      h.deps,
    );

    const uris = printedUris(h.lines);
    expect(uris.map((uri) => new URL(uri).username).sort()).toEqual([
      "waitron_app",
      "waitron_migrator",
      "waitron_provisioner",
    ]);
    // The target database, not the admin's own: a connection string that pointed at `postgres`
    // would be one the host cannot boot on.
    for (const uri of uris) expect(new URL(uri).pathname).toBe(`/${DATABASE}`);
    expect(h.lines.join("\n")).toMatch(/ONCE/);
    expect(h.cleared()).toBe(1);
  });

  it("waits for the operator before clearing the connection strings away", async () => {
    // The mutant this rules out is real, not hypothetical: the first draft of `reportRoles` ended
    // with `void deps.io.prompt(...).then(() => clearScreen())`, which wipes three unrecoverable
    // passwords off the screen before the operator has copied them. A test that only checked
    // "clearScreen was called once" passes against that draft — the marker order is identical,
    // because both are pushed before any await boundary. Holding the answer open is what
    // distinguishes them. Same shape as `keyring-command.test.ts`'s equivalent.
    const order: string[] = [];
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const deps: CliDeps = {
      ...h.deps,
      io: {
        stdout: () => order.push("print"),
        stderr: () => order.push("print"),
        prompt: async () => {
          order.push("prompt");
          await answered;
          return "";
        },
        promptSecret: async () => ADMIN_URI,
        clearScreen: () => order.push("clear"),
      },
    };

    const running = runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
      deps,
    );
    // Nothing here is timer-based, so if the clear were not gated on the answer it would already
    // have happened by the time these microtasks drain.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(order).toContain("prompt");
    expect(order).not.toContain("clear");

    answer();
    expect(await running).toBe(0);
    expect(order.indexOf("prompt")).toBeLessThan(order.indexOf("clear"));
  });

  it("says a pre-existing role already existed and shows NO connection string for it", async () => {
    // This tool cannot know the password of a role it did not just generate one for, and printing
    // a wrong connection string is worse than printing none.
    const h = harness({ state: PROVISIONED, env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(0);

    const printed = h.lines.join("\n");
    expect(printedUris(h.lines)).toEqual([]);
    expect(printed).toMatch(/waitron_migrator.*already exist/i);
    expect(printed).toMatch(/waitron_app.*already exist/i);
    expect(printed).toMatch(/waitron_provisioner.*already exist/i);
    // Nothing secret was printed, so there is nothing to wipe — and wiping would take the plan
    // summary with it for no reason.
    expect(h.cleared()).toBe(0);
  });

  it("summarises a membership repair", async () => {
    // The `grant-membership` action reaches the summary only from a DRIFTED state — every role in
    // BLANK gets its memberships from `CREATE ROLE ... IN ROLE` instead — so it needs its own
    // fixture or the summary's branch for it is never rendered.
    const drifted = stateOf({
      databaseExists: true,
      roles: {
        ...PROVISIONED.roles,
        waitron_provisioner: facts({ memberOf: ["app_user"] }),
      },
      inside: PROVISIONED.inside,
    });
    const h = harness({
      answers: ["n"],
      state: drifted,
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    expect(h.lines.join("\n")).toContain("grant tenant_provisioner to waitron_provisioner");
  });

  it("opens a connection to the target database only when it already exists", async () => {
    const blank = harness({ answers: ["n"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction"],
      blank.deps,
    );
    expect(blank.connect).toHaveBeenCalledTimes(1);

    const existing = harness({
      answers: ["n"],
      state: PROVISIONED,
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction"],
      existing.deps,
    );
    expect(existing.connect).toHaveBeenCalledTimes(2);
    expect(existing.connect).toHaveBeenLastCalledWith(
      "postgres://admin:adminsecret@db.example:5432/waitron_demo",
    );
    // Both connections closed, whichever way the run ended.
    expect(existing.closes()).toBe(2);
  });

  it("refuses an environment that is not a deployment environment", async () => {
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli(
      ["instance", "--database", DATABASE, "--environment", "staging"],
      h.deps,
    );
    expect(code).toBe(1);
    // The structured code, not merely a non-zero exit: USAGE also names both environments, so a
    // version that printed usage and returned 2 would pass a looser assertion.
    expect(h.lines.join("\n")).toContain("deployment.unknown_environment");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("refuses a database name outside the identifier rule before connecting", async () => {
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli(
      ["instance", "--database", "Waitron Prod", "--environment", "preproduction"],
      h.deps,
    );
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain("provisioning.invalid_identifier");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("reports an AppError from the apply as code + params, and says roles may be orphaned", async () => {
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      apply: () =>
        Promise.reject(
          new AppError("provisioning.membership_grant_failed", {
            role: "waitron_app",
            of: "app_user",
            sqlstate: "42501",
          }),
        ),
    });
    const code = await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
      h.deps,
    );

    expect(code).toBe(1);
    const printed = h.lines.join("\n");
    expect(printed).toContain("provisioning.membership_grant_failed");
    expect(printed).toContain('"sqlstate":"42501"');
    // A half-applied plan can leave a role created with a password this run never printed. Saying
    // so is the difference between a recoverable state and an unusable one: there is no way to
    // learn that password afterwards, so the operator must drop the role and re-run.
    expect(printed).toMatch(/drop/i);
    expect(printedUris(h.lines)).toEqual([]);
  });

  it("hands the apply an openTarget pointing at the target database, not the admin's own", async () => {
    // `applyInstance` needs its own connection to the target for the schema-level grants and the
    // stamp, and cannot open one itself. A version that passed the ADMIN connection string through
    // unchanged would grant `create on schema public` in the WRONG database — silently, since both
    // statements succeed.
    let opened: Database | undefined;
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      apply: async (_actions, applyDeps) => {
        opened = await applyDeps.openTarget();
        expect(applyDeps.database).toBe(DATABASE);
        expect(applyDeps.adminUri).toBe(ADMIN_URI);
        expect(applyDeps.migrationsRoot).toBeNull();
      },
    });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(0);
    expect(opened).toBeDefined();
    expect(h.connect).toHaveBeenCalledWith(
      "postgres://admin:adminsecret@db.example:5432/waitron_demo",
    );
  });

  it("lets an unrecognised failure from the apply escape to bin.ts", async () => {
    // `reportFailure` formats an AppError and RETHROWS anything else — a database fault, a bug —
    // rather than flattening it into an exit code that claims the tool understood it.
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      apply: () => Promise.reject(new TypeError("undefined is not a function")),
    });
    await expect(
      runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).rejects.toThrow("undefined is not a function");
    expect(h.closes()).toBe(1);
  });

  it("turns a read that the database refused into a structured code", async () => {
    // The case a real operator hits, reproduced end to end against a container before this code
    // existed: a SECOND `login createdb createrole` admin — one that did not create the target
    // database — cannot read the tables inside it, so `readInstanceState`'s stamp read fails with
    // `permission denied for table deployment`. Through the bundle that printed exactly
    // `unexpected failure (Error)`, with no database named, no code and no remedy.
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      readState: () =>
        Promise.reject(
          Object.assign(
            new Error("Failed query: select environment from deployment where id = 1"),
            {
              cause: Object.assign(new Error("permission denied for table deployment"), {
                code: "42501",
              }),
            },
          ),
        ),
    });
    const code = await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction"],
      h.deps,
    );
    expect(code).toBe(1);
    const printed = h.lines.join("\n");
    expect(printed).toContain("provisioning.state_unreadable");
    expect(printed).toContain('"sqlstate":"42501"');
    expect(printed).toContain(`"database":"${DATABASE}"`);
    // The driver's own message quotes the failed query back. Never printed.
    expect(printed).not.toContain("Failed query");
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("reports a refused read from status too", async () => {
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      readState: () => Promise.reject(Object.assign(new Error("nope"), { code: "42501" })),
    });
    expect(await runCli(["status", "--database", DATABASE], h.deps)).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.state_unreadable {"database":"waitron_demo","sqlstate":"42501"}',
    );
  });

  it("reports a refused CONNECT, not only a refused read", async () => {
    // 28P01 is `invalid_password`, and it arrives at `connect` — `pg` authenticates when the pool
    // hands out its first connection, not at the first query. Verified through the built bundle
    // against a container: with the connect outside the guard the operator saw
    // `unexpected failure (error)` for a mistyped password, which is the single likeliest thing to
    // get wrong about a pasted connection string.
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    h.connect.mockRejectedValue(
      Object.assign(new Error('password authentication failed for user "admin"'), {
        code: "28P01",
      }),
    );
    expect(await runCli(["status", "--database", DATABASE], h.deps)).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.state_unreadable {"database":"waitron_demo","sqlstate":"28P01"}',
    );
    expect(h.readState).not.toHaveBeenCalled();
  });

  it("lets a connect failure with no SQLSTATE escape unchanged", async () => {
    // A refused socket is not the database's verdict on anything, so it is not dressed up as one.
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    h.connect.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    await expect(runCli(["status", "--database", DATABASE], h.deps)).rejects.toThrow(
      "connect ECONNREFUSED",
    );
  });

  it("lets an error nobody here recognises escape to bin.ts", async () => {
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      readState: () => Promise.reject(new Error("the pool is closed")),
    });
    await expect(
      runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps),
    ).rejects.toThrow("the pool is closed");
    // Still closed, even on the path that rethrows.
    expect(h.closes()).toBe(1);
  });

  it("reports the planner's own refusal rather than throwing out of runCli", async () => {
    const h = harness({
      state: stateOf({
        databaseExists: true,
        roles: { waitron_migrator: facts({ superuser: true }) },
        inside: { migratedSets: manifestSets().map((set) => set.name), stamp: "preproduction" },
      }),
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    const code = await runCli(
      ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
      h.deps,
    );
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain("provisioning.role_over_privileged");
    expect(h.apply).not.toHaveBeenCalled();
  });
});

describe("runCli status", () => {
  it("prints the formatted state and returns 0", async () => {
    const h = harness({ state: PROVISIONED, env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(await runCli(["status", "--database", DATABASE], h.deps)).toBe(0);
    const printed = h.lines.join("\n");
    expect(printed).toContain(`database ${DATABASE}: present`);
    expect(printed).toContain("role waitron_migrator: present");
    expect(printed).toContain("deployment stamp: preproduction");
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("prompts for the database name when no flag gave one", async () => {
    const h = harness({
      answers: [DATABASE],
      state: BLANK,
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    expect(await runCli(["status"], h.deps)).toBe(0);
    expect(h.asked.join(" ")).toMatch(/database/i);
    expect(h.lines.join("\n")).toContain(`database ${DATABASE}: absent`);
  });

  it("reports a bad database name as a structured code", async () => {
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli(["status", "--database", "Waitron Prod"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain("provisioning.invalid_identifier");
  });
});

describe("the error codes this CLI raises", () => {
  it("names the domain concept, never the package", async () => {
    // The house rule (packages/shared/src/errors.ts): `series.not_found`, not
    // `db.series_not_found`. `deployment.unknown_environment` is about a deployment environment,
    // which is why it sits beside `deployment.already_stamped` rather than under `provisioning.`
    // — the provisioning tool is merely where an operator happens to type it.
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    await runCli(["instance", "--database", DATABASE, "--environment", "staging"], h.deps);
    const line = h.lines.find((l) => l.startsWith("deployment.unknown_environment"));
    expect(line).toBeDefined();
    expect(line).toContain('"value":"staging"');
    expect(line).toContain("preproduction");
  });

  it("throws an AppError, not a bare Error, for an unknown environment", () => {
    const error = new AppError("deployment.unknown_environment", {
      value: "staging",
      known: ["production", "preproduction"],
    });
    expect(isAppError(error)).toBe(true);
  });
});
