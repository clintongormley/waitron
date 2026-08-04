import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import type { InstanceState, RoleFacts } from "./instance-state.js";
import type { VenueAction } from "./venue-plan.js";
import type { VenueApplyDeps, VenueResult } from "./venue-apply.js";
import { obligadoTenantId } from "./tenant-id.js";

const DATABASE = "waitron_demo";
const ADMIN_URI = "postgres://admin:adminsecret@db.example:5432/postgres";

/** What the injected `applyVenue` hands back — the ids `venue` prints in its result summary. The
 * `sif` is trimmed to the two fields the summary reads (`id`, `numeroInstalacion`); the rest of
 * `SifRegistration` is irrelevant to what this CLI does with the result. */
const VENUE_RESULT = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  locationId: "22222222-2222-2222-2222-222222222222",
  tillId: "33333333-3333-3333-3333-333333333333",
  nodeId: "44444444-4444-4444-4444-444444444444",
  sif: { id: "55555555-5555-5555-5555-555555555555", numeroInstalacion: 1 },
  seriesIds: ["66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"],
} as unknown as VenueResult;

/** Every venue option supplied, so a run reaches the apply with no prompt. `--territory ES-common`
 * is the one implemented set (fiscal-modules.ts); tests that need a refusal swap it out. */
const VENUE_ARGS = [
  "venue",
  "--database",
  DATABASE,
  "--country",
  "ES",
  "--tax-id",
  "B12345678",
  "--legal-name",
  "Acme SL",
  "--location-name",
  "Centro",
  "--territory",
  "ES-common",
  "--locale",
  "es-ES",
  "--operation-description",
  "Restaurante",
  "--address-line1",
  "Calle Mayor 1",
  "--address-line2",
  "Piso 2",
  "--postal-code",
  "28001",
  "--city",
  "Madrid",
  "--province",
  "Madrid",
  "--time-zone",
  "Europe/Madrid",
  "--day-cutover",
  "06:00",
  "--till-name",
  "Barra 1",
  "--series-code",
  "A",
  "--rectificative-code",
  "R",
];

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
 * out so it tracks a newly added migration package — but note the plan still carries a `migrate`
 * regardless, because `planInstance` no longer gates on journal presence. */
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
  applyVenue: ReturnType<typeof vi.fn>;
  readEnvironment: ReturnType<typeof vi.fn>;
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
    applyVenue?: CliDeps["applyVenue"];
    readEnvironment?: () => Promise<DeploymentEnvironment | null>;
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
  // The two venue seams, injected exactly like `readState`/`apply`: their real implementations need
  // a live target database and what `venue` DECIDES — what it prompts, prints, refuses — does not.
  const applyVenue = vi.fn(options.applyVenue ?? (async () => VENUE_RESULT));
  const readEnvironment = vi.fn(
    options.readEnvironment ?? (async () => "preproduction" as DeploymentEnvironment),
  );

  return {
    lines,
    asked,
    askedSecretly,
    cleared: () => cleared,
    closes: () => closes,
    apply,
    readState,
    applyVenue,
    readEnvironment,
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
      applyVenue: applyVenue as unknown as CliDeps["applyVenue"],
      readEnvironment: readEnvironment as unknown as CliDeps["readEnvironment"],
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
    // ALL THREE commands, not the two that take options: `keyring` takes none and used to discard
    // its argv entirely, so `keyring --password hunter2` printed the key ring and exited 0 while
    // USAGE and README both promised such a flag was a parse error.
    for (const flag of ["--password", "--key", "--admin-password"]) {
      for (const command of ["keyring", "instance", "status", "venue"]) {
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
    for (const command of ["keyring", "instance", "status", "venue"]) {
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

  it("rejects a stray positional after keyring, which takes no options at all", async () => {
    const h = harness();
    expect(await runCli(["keyring", "extra"], h.deps)).toBe(2);
    // The refusal must come BEFORE the key ring is generated and printed — a tool that printed an
    // unrecoverable key and then complained about an argument would be worse than one that ignored
    // the argument.
    expect(h.lines.join("\n")).not.toContain("WAITRON_CREDENTIALS_KEY=");
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

  it("refuses an empty admin connection string on both paths that take one", async () => {
    // `pg` does not refuse one either, which is the whole hazard. Run against this repo's
    // `pg@8.22.0`: `new Client({ connectionString: "" })` came back as
    // `{host:"localhost",port:5432,user:"<OS user>",database:"<OS user>"}`, and `pg-pool@3.14.0`
    // builds every client with `new this.Client(this.options)` (`index.js:241`) off the same
    // options object. So an unset or misspelled WAITRON_ADMIN_DATABASE_URL plus a stdin that
    // answers nothing — the non-interactive shape README.md documents for CI, where `bin.ts`'s
    // `ask` returns `""` on an exhausted stream or Ctrl+D — would have had `instance` create,
    // migrate and STAMP a database on whatever cluster answers on localhost:5432. One database per
    // environment is a fiscal invariant and a stamp is not undoable.
    for (const command of [
      ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
      ["status", "--database", DATABASE],
    ]) {
      const h = harness({ env: {}, secrets: [""] });
      expect(await runCli(command, h.deps)).toBe(1);
      expect(h.lines.join("\n")).toContain(
        'provisioning.admin_uri_missing {"variable":"WAITRON_ADMIN_DATABASE_URL"}',
      );
      // Nothing was opened, so nothing could be written. The exit code alone would pass against a
      // version that connected first and complained afterwards.
      expect(h.connect).not.toHaveBeenCalled();
      expect(h.apply).not.toHaveBeenCalled();
    }
  });

  it("counts an empty env var and a blank answer as nothing supplied, not as a value", async () => {
    for (const options of [
      // Set but empty: `resolveAdminUri` falls through to the prompt, which also answers nothing.
      { env: { WAITRON_ADMIN_DATABASE_URL: "" }, secrets: [""] },
      // Whitespace only, from the prompt: `.trim()` makes it the same case.
      { env: {}, secrets: ["   "] },
    ]) {
      const h = harness(options);
      expect(await runCli(["status", "--database", DATABASE], h.deps)).toBe(1);
      expect(h.lines.join("\n")).toContain("provisioning.admin_uri_missing");
      expect(h.connect).not.toHaveBeenCalled();
    }
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

  it("shows a migrate in the plan for an already-provisioned deployment", async () => {
    // The operator-facing half of the gate removal. `PROVISIONED` has every manifest set journalled
    // and the stamp already correct, which is the state that used to plan nothing but two grants.
    // The wording is asserted verbatim because it is what an operator reads before typing `y`
    // against a live cluster: "apply every migration set" invited the reading that the tool was
    // about to re-run all of them.
    const h = harness({
      answers: ["n"],
      state: PROVISIONED,
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    expect(h.lines.join("\n")).toContain("apply any pending migrations, in every set");
  });

  it("names the cluster it is about to write to, and never the admin's password", async () => {
    // A confirmation that cannot reveal the mistake it exists to catch is a weak confirmation. The
    // summary named a database and an environment and nothing else, so an admin URI pointing at the
    // WRONG cluster looked exactly like the right one — and that is the fiscally expensive mistake,
    // because one database per environment is an invariant and `instance` STAMPS whatever it is
    // pointed at.
    const h = harness({ answers: ["n"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    const printed = h.lines.join("\n");
    expect(printed).toContain("Cluster: admin@db.example:5432");
    // Host, port and username. Never the password, and never the whole string.
    expect(printed).not.toContain("adminsecret");
    expect(printed).not.toContain(ADMIN_URI);
  });

  it("names a cluster whose connection string carries no user by host alone", async () => {
    const h = harness({
      answers: ["n"],
      env: { WAITRON_ADMIN_DATABASE_URL: "postgres://db.example:5432/postgres" },
    });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    expect(h.lines.join("\n")).toContain("Cluster: db.example:5432");
  });

  it("refuses an admin connection string that is not a URL, from either source", async () => {
    // `pg` accepts connection-string forms `new URL` rejects, and at least one of them WORKS. Run
    // inside a `postgres:18-alpine` container (PostgreSQL 18.4) with this repo's `pg@8.22.0`, over
    // the connection string `/var/run/postgresql`: pg parsed it to
    // `{host:"/var/run/postgresql",port:5432}`, `connect()` succeeded, and
    // `select inet_server_addr() is null` returned `t` — a live connection over the cluster's Unix
    // socket. `new URL("/var/run/postgresql")` threw `TypeError: Invalid URL` in the same process.
    // The keyword form is the same disagreement without a working connection: pg parsed
    // `host=db.example port=5433 user=adm` to `{host:"base"}` and `new URL` threw.
    //
    // This tool RE-POINTS that string at another database in three places — `withDatabase` for the
    // state read and for the migrator's URL (`instance-apply.ts`), `roleUri` for each printed
    // connection string — and every one of them is a `new URL`. Verified directly: with the socket
    // path as the argument, both `withDatabase(uri, "waitron_prod")` and
    // `roleUri(uri, "waitron_app", "pw", "waitron_prod")` threw `TypeError: Invalid URL`. So the
    // socket form used to reach `withDatabase` as a WORKING admin connection and leave as
    // `unexpected failure (TypeError)` (`bin.ts`'s catch-all) — on the `instance` path, after
    // `create database`, `migrate` and `stamp` had already run.
    //
    // Refused up front instead of half-supported: see `resolveAdminUri`.
    for (const uri of ["/var/run/postgresql", "host=db.example port=5433 user=adm"]) {
      for (const source of [
        { env: { WAITRON_ADMIN_DATABASE_URL: uri } },
        { env: {}, secrets: [uri] },
      ]) {
        for (const command of [
          ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
          ["status", "--database", DATABASE],
        ]) {
          const h = harness(source);
          expect(await runCli(command, h.deps)).toBe(1);
          expect(h.lines.join("\n")).toContain(
            'provisioning.admin_uri_not_a_url {"variable":"WAITRON_ADMIN_DATABASE_URL"}',
          );
          // Nothing was opened and nothing was applied. The exit code alone would pass against a
          // version that connected, created and migrated first and threw on the way out.
          expect(h.connect).not.toHaveBeenCalled();
          expect(h.apply).not.toHaveBeenCalled();
        }
      }
    }
  });

  it("never echoes a refused non-URL connection string back", async () => {
    // The refusal above prints a CODE and the variable's NAME. The string itself can carry a
    // password in every form pg accepts — `host=db.example password=hunter2` is one — so it is
    // withheld for the same reason `provisioning.admin_uri_missing` withholds it.
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: "host=db.example password=hunter2" } });
    expect(await runCli(["status", "--database", DATABASE], h.deps)).toBe(1);
    expect(h.lines.join("\n")).not.toContain("hunter2");
    expect(h.lines.join("\n")).not.toContain("db.example");
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

  it("warns in the PLAN that no connection string will be printed, before asking", async () => {
    // The second-database-on-one-cluster case: every `waitron_*` role already exists, so `instance`
    // creates none and prints no connection string for any of them. That was disclosed only in
    // `reportRoles`, i.e. after create/migrate/stamp had run — by which point declining is not an
    // option. `created.length === 0` is knowable from the PLAN, which is pure, so the operator gets
    // it while "Apply this plan? [y/N]" is still unanswered.
    const h = harness({ state: PROVISIONED, env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    // Snapshotted at the moment the question is asked, not scanned afterwards: the prompt goes
    // through `io.prompt` and never reaches the transcript, so "before the prompt" cannot be read
    // off the finished output — and a warning printed after it is one the operator could not act
    // on.
    let seenWhenAsked: string[] | undefined;
    const deps: CliDeps = {
      ...h.deps,
      io: {
        ...h.deps.io,
        prompt: async (question) => {
          if (question.includes("Apply this plan?")) seenWhenAsked = [...h.lines];
          return "n";
        },
      },
    };
    expect(
      await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], deps),
    ).toBe(1);

    expect(seenWhenAsked?.join("\n")).toMatch(/No connection strings will be printed/i);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("does not warn about connection strings when the run will print some", async () => {
    // The negative control: on a first provision all three roles are created, so the warning would
    // be false. Without this, a version that printed it unconditionally passes the test above.
    const h = harness({ answers: ["n"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    expect(h.lines.join("\n")).not.toMatch(/No connection strings will be printed/i);
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
            memberOf: "app_user",
            sqlState: "42501",
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
    expect(printed).toContain('"sqlState":"42501"');
    // A half-applied plan can leave a role created with a password this run never printed. Saying
    // so is the difference between a recoverable state and an unusable one: there is no way to
    // learn that password afterwards, so the operator must drop the role and re-run.
    expect(printed).toMatch(/drop/i);
    // NAMED, not described. `created` is in scope at the point this is printed and holds exactly
    // the roles this run minted, so telling the operator to run `status` and work out which
    // `waitron_*` roles to drop asked them to re-derive something already on hand — and to do it
    // under the one condition where the tool has just failed. BLANK is the fixture, so all three
    // were created.
    expect(printed).toContain("DROP ROLE waitron_migrator");
    expect(printed).toContain("DROP ROLE waitron_app");
    expect(printed).toContain("DROP ROLE waitron_provisioner");
    expect(printedUris(h.lines)).toEqual([]);
  });

  it("names only the roles THIS run created, not every role the deployment has", async () => {
    // The drifted fixture creates one role and leaves two alone. Naming all three would send the
    // operator to drop two roles whose passwords this tool never generated and whose owners are
    // still using them — strictly worse than the vague advice this replaced.
    const drifted = stateOf({
      databaseExists: true,
      roles: {
        waitron_migrator: facts({ createRole: true }),
        waitron_app: facts(),
      },
      inside: PROVISIONED.inside,
    });
    const h = harness({
      state: drifted,
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      apply: () =>
        Promise.reject(
          new AppError("provisioning.grant_ineffective", { database: DATABASE, missing: [] }),
        ),
    });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(1);

    const printed = h.lines.join("\n");
    expect(printed).toContain("DROP ROLE waitron_provisioner");
    expect(printed).not.toContain("DROP ROLE waitron_migrator");
    expect(printed).not.toContain("DROP ROLE waitron_app");
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
        opened = (await applyDeps.openTarget()).db;
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

  it("opens the target database ONCE on a re-run, not once per consumer", async () => {
    // On every run after the first, `withState` opens a connection to the target to read the
    // deployment's state, and `applyInstance` then wants one too — on EVERY run, because the
    // migrator's schema grant is re-issued unconditionally (`instance-plan.ts`). Those used to be
    // two separate dials of the same database. `createPostgresDb` connects and releases up front,
    // so the second was a real TCP connect and auth handshake per run, not a cheap object.
    //
    // The exact URIs, in order, rather than a count: a count alone would pass against a version
    // that dialled the ADMIN string twice and never reached the target at all.
    const h = harness({
      state: PROVISIONED,
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      apply: async (_actions, applyDeps) => {
        const first = await applyDeps.openTarget();
        expect(first.db).toBeDefined();
        await first.release();
      },
    });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(0);

    expect(h.connect.mock.calls.map((call) => call[0])).toEqual([
      ADMIN_URI,
      "postgres://admin:adminsecret@db.example:5432/waitron_demo",
    ]);
    // And both are closed exactly once — `release` is a no-op precisely because `withState`'s
    // `finally` is the single place either handle dies. A version that closed in both would run
    // this to 3 and, against a real `pg` pool, throw.
    expect(h.closes()).toBe(2);
  });

  it("opens the target ONCE on a first provision too, when the apply is what needs it", async () => {
    // The other half: the database does not exist, so `withState` opens nothing for the state read
    // and the apply's own request is the first. It must still be one connection, and `withState`
    // must still be the thing that closes it — the accessor caches into the same slot the `finally`
    // reads.
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      apply: async (_actions, applyDeps) => {
        await (await applyDeps.openTarget()).release();
        await (await applyDeps.openTarget()).release();
      },
    });
    expect(
      await runCli(
        ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
        h.deps,
      ),
    ).toBe(0);

    expect(h.connect.mock.calls.map((call) => call[0])).toEqual([
      ADMIN_URI,
      "postgres://admin:adminsecret@db.example:5432/waitron_demo",
    ]);
    expect(h.closes()).toBe(2);
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
    expect(printed).toContain('"sqlState":"42501"');
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
      'provisioning.state_unreadable {"database":"waitron_demo","sqlState":"42501"}',
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
      'provisioning.state_unreadable {"database":"waitron_demo","sqlState":"28P01"}',
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

describe("runCli venue", () => {
  it("reads the stamp, applies the planned actions against the target, and exits 0", async () => {
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);

    // The environment stamp is READ before anything is applied — an unstamped database is refused
    // (see the next test), and the plan summary names the environment it read.
    expect(h.readEnvironment).toHaveBeenCalledTimes(1);

    // Applied ONCE, with the plan `planVenue` produced, against the TARGET connection (the
    // owner-admin that owns the tables, Task C1) — never the instance apply path.
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
    expect(h.apply).not.toHaveBeenCalled();
    const [actions, applyDeps] = h.applyVenue.mock.calls[0] as [VenueAction[], VenueApplyDeps];
    expect(actions.map((action) => action.kind)).toEqual([
      "ensure-tenant",
      "create-location",
      "create-till",
      "create-node",
      "register-sif",
      "create-series",
      "create-series",
    ]);

    // `withVenueState` re-points the admin URI at the target database and hands THAT connection to
    // the apply — not the admin's own database, where every insert would land under the wrong RLS
    // scope, and not a second dial of it.
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.connect).toHaveBeenCalledWith(
      "postgres://admin:adminsecret@db.example:5432/waitron_demo",
    );
    expect(applyDeps.db).toBe(await h.connect.mock.results[0].value);

    const printed = h.lines.join("\n");
    expect(printed).toContain("Plan for a venue in waitron_demo (preproduction):");
    // The cluster the operator is about to write to — host, port, user; never the password.
    expect(printed).toContain("Cluster: admin@db.example:5432");
    expect(printed).toContain("ensure tenant ES/B12345678");
    expect(printed).toContain("create location Centro in ES-common");
    // The result summary names the node and the SIF the apply returned.
    expect(printed).toContain(`node:     ${VENUE_RESULT.nodeId}`);
    expect(printed).toContain(`SIF:      ${VENUE_RESULT.sif.id} (installation 1)`);

    // No secret anywhere: the admin password is never echoed and venue mints no connection strings.
    expect(printed).not.toContain("adminsecret");
    expect(printed).not.toContain(ADMIN_URI);
    expect(printedUris(h.lines)).toEqual([]);
    // The target connection was closed, whichever way the run ended.
    expect(h.closes()).toBe(1);
  });

  it("refuses an unimplemented territory and applies nothing", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "ES-common" ? "ES-PV-bizkaia" : arg));
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines).toContainEqual(expect.stringContaining("fiscal.regime_not_implemented"));
    expect(h.applyVenue).not.toHaveBeenCalled();
    // Refused by the PURE planner, before the admin credential is asked for or any connection is
    // opened (venue-plan.ts / errors.ts: "no admin connection is spent on a malformed request").
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("refuses an unstamped database before applying", async () => {
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      readEnvironment: async () => null,
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.database_unstamped {"database":"waitron_demo"}',
    );
    // The stamp was read — that is how the emptiness was learnt — and nothing was applied.
    expect(h.readEnvironment).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("refuses a country that is not two ASCII letters, before connecting", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "ES" ? "ESP" : arg));
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('provisioning.invalid_country {"value":"ESP"}');
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("upper-cases the country so es and ES resolve to the same obligado", async () => {
    // ISO-3166 alpha-2 is upper-case by convention, but an operator may type `es`. The derived
    // tenant id hashes `country` verbatim (tenant-id.ts) and `(country, tax_id)` is a case-sensitive
    // unique index, so `es` and `ES` must NOT mint two permanent obligados — the CLI normalises to
    // upper-case at the boundary, which is what makes a D8 re-run reuse the same obligado.
    const args = VENUE_ARGS.map((arg) => (arg === "ES" ? "es" : arg));
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({
      kind: "ensure-tenant",
      country: "ES",
      tenantId: obligadoTenantId("ES", "B12345678"),
    });
  });

  it("trims a flag-provided --tax-id so surrounding whitespace derives the SAME obligado", async () => {
    // The load-bearing one: prompted values are trimmed (`(await io.prompt(...)).trim()`) but flag
    // values were not, so `--tax-id " B12345678 "` used to reach `obligadoTenantId` verbatim and
    // hash into a DIFFERENT tenant id than the trimmed form — a permanent, unmergeable second
    // obligado from nothing but a stray space, the same footgun class as the country-case bug. The
    // derived id and the stored tax_id must both match the trimmed identity.
    const args = VENUE_ARGS.map((arg) => (arg === "B12345678" ? " B12345678 " : arg));
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({
      kind: "ensure-tenant",
      taxId: "B12345678",
      tenantId: obligadoTenantId("ES", "B12345678"),
    });
  });

  it("treats a whitespace-only flag as absent and prompts for it, matching a bare flag", async () => {
    // `resolveOption`'s docstring says an empty flag counts as absent; a whitespace-only flag must
    // too, so flag and prompt behave identically. `--legal-name "   "` therefore falls through to
    // the prompt rather than being accepted verbatim.
    const args = VENUE_ARGS.map((arg) => (arg === "Acme SL" ? "   " : arg));
    const h = harness({ answers: ["Acme SL"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);
    // The prompt for the legal name fired — the whitespace flag did not stand in for it.
    expect(h.asked).toContain("legal name: ");
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({ kind: "ensure-tenant", legalName: "Acme SL" });
  });

  it("trims a flag-provided --locale, matching the prompted path", async () => {
    // `resolveLocales`' prompted path trims each answer; the flag path did not, so `--locale
    // " es-ES "` used to reach the plan with the surrounding whitespace intact.
    const args = VENUE_ARGS.map((arg) => (arg === "es-ES" ? " es-ES " : arg));
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const location = actions.find((action) => action.kind === "create-location");
    expect(location?.kind === "create-location" && location.invoiceLocales).toEqual(["es-ES"]);
  });

  it("refuses a database name outside the identifier rule before connecting", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === DATABASE ? "Waitron Prod" : arg));
    const h = harness({ env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain("provisioning.invalid_identifier");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("applies when the operator confirms with y", async () => {
    const h = harness({ answers: ["y"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(await runCli(VENUE_ARGS, h.deps)).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
    // Without --yes, the plan confirmation IS asked.
    expect(h.asked.join(" ")).toMatch(/Apply this plan/i);
  });

  it("accepts a spelt-out 'yes' as confirmation too", async () => {
    const h = harness({ answers: ["yes"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    expect(await runCli(VENUE_ARGS, h.deps)).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
  });

  it("applies NOTHING when the operator declines", async () => {
    const h = harness({ answers: ["n"], env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    const code = await runCli(VENUE_ARGS, h.deps);
    expect(code).toBe(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    const printed = h.lines.join("\n");
    expect(printed).toContain("Nothing was applied.");
    // The plan was still shown before the decline, and the connection closed.
    expect(printed).toContain("Plan for a venue in waitron_demo");
    expect(h.closes()).toBe(1);
  });

  it("maps a concurrent unique-violation from the apply to provisioning.venue_conflict", async () => {
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      applyVenue: () => Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('provisioning.venue_conflict {"database":"waitron_demo"}');
    // The driver's own message can quote the failing statement; it is never printed.
    expect(h.lines.join("\n")).not.toContain("dup");
    expect(h.closes()).toBe(1);
  });

  it("lets an unrecognised failure from the apply escape to bin.ts", async () => {
    // Anything that is not a unique violation is rethrown untouched — a database fault or a bug is
    // not something this file understood, mirroring the instance path.
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      applyVenue: () => Promise.reject(new TypeError("undefined is not a function")),
    });
    await expect(runCli([...VENUE_ARGS, "--yes"], h.deps)).rejects.toThrow(
      "undefined is not a function",
    );
    expect(h.closes()).toBe(1);
  });

  it("prompts for every omitted option, in order, reading the admin URI from the env", async () => {
    const h = harness({
      answers: [
        DATABASE,
        "ES",
        "B12345678",
        "Acme SL",
        "Centro",
        "ES-common",
        "es-ES", // first invoice locale
        "ca-ES", // a second one
        "", // blank ends the locale loop
        "Restaurante",
        "Calle Mayor 1",
        "", // address line 2 is optional — blank means none
        "28001",
        "Madrid",
        "Madrid",
        "Europe/Madrid",
        "06:00",
        "Barra 1",
        "A",
        "R",
      ],
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    // `--yes` so the confirmation prompt does not appear amid the option prompts.
    const code = await runCli(["venue", "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);

    // The exact question sequence — proving both order and wording. The two invoice-locale entries
    // exercise the repeat-until-blank loop, and the admin URI came from the env (echo-off prompt
    // never fired).
    expect(h.asked).toEqual([
      "database name: ",
      "country (ISO-3166 alpha-2, e.g. ES): ",
      "tax id (NIF): ",
      "legal name: ",
      "location name: ",
      "fiscal territory (e.g. ES-common): ",
      "invoice locale (e.g. es-ES): ",
      "another invoice locale (blank to finish): ",
      "another invoice locale (blank to finish): ",
      "operation description: ",
      "address line 1: ",
      "address line 2 (blank if none): ",
      "postal code: ",
      "city: ",
      "province: ",
      "time zone (e.g. Europe/Madrid): ",
      "day cutover (HH:MM): ",
      "till name: ",
      "series code: ",
      "rectificative series code: ",
    ]);
    expect(h.askedSecretly).toEqual([]);

    // The two locales prompted for reach the plan.
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const location = actions.find((action) => action.kind === "create-location");
    expect(location?.kind === "create-location" && location.invoiceLocales).toEqual([
      "es-ES",
      "ca-ES",
    ]);
    // The optional address line 2 was left blank, so it is null in the plan.
    expect(location?.kind === "create-location" && location.addressLine2).toBeNull();
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
    expect(line).toContain('"environment":"staging"');
    expect(line).toContain("preproduction");
  });
});
