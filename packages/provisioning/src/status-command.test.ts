import { describe, expect, it } from "vitest";
import { formatStatus } from "./status-command.js";
import type { InstanceState } from "./instance-state.js";

const PROVISIONED: InstanceState = {
  database: "waitron",
  databaseExists: true,
  roles: {
    waitron_migrator: {
      canLogin: true,
      createRole: true,
      superuser: false,
      memberOf: ["app_user"],
    },
    waitron_app: {
      canLogin: true,
      createRole: false,
      superuser: false,
      memberOf: ["app_user"],
    },
  },
  inside: { migratedSets: ["core", "fiscal"], stamp: "preproduction" },
};

describe("formatStatus", () => {
  it("names every role, present or absent", () => {
    const text = formatStatus({
      ...PROVISIONED,
      roles: { waitron_app: PROVISIONED.roles.waitron_app! },
    }).join("\n");
    expect(text).toContain("waitron_migrator");
    expect(text).toContain("waitron_app");
    // The ABSENT one is the useful line: a status that listed only what exists would leave an
    // operator to remember what the full set is.
    expect(text).toMatch(/waitron_migrator.*absent/);
  });

  it("reports the stamp", () => {
    expect(formatStatus(PROVISIONED).join("\n")).toContain("preproduction");
  });

  it("spells out every attribute that makes a role unusable or unadoptable", () => {
    // These are the roles `planInstance` REFUSES (`provisioning.role_unusable`,
    // `provisioning.role_over_privileged`), so this report is what an operator reads immediately
    // after being refused. A line that said only "present" would send them to `psql` to find out
    // why. Every branch here corresponds to one refusal reason in instance-plan.ts's
    // `assertUsable`.
    const text = formatStatus({
      database: "waitron",
      databaseExists: true,
      roles: {
        waitron_migrator: {
          canLogin: false,
          createRole: false,
          superuser: false,
          memberOf: [],
        },
        waitron_app: {
          canLogin: true,
          createRole: false,
          superuser: true,
          memberOf: ["app_user"],
        },
      },
      inside: { migratedSets: [], stamp: null },
    }).join("\n");

    expect(text).toContain("role waitron_migrator: present — NOLOGIN, member of nothing");
    expect(text).toContain("SUPERUSER");
    // Unstamped is a real, common state — every database provisioned before the stamp existed —
    // and is reported as such rather than as an empty field.
    expect(text).toContain("deployment stamp: unstamped");
    expect(text).toMatch(/migration set core: journal absent/);
  });

  it("reports a journal's existence, never that a set finished", () => {
    // `readInside` reads `to_regclass('public.<journal table>')` and nothing else
    // (instance-state.ts), and Drizzle creates that table BEFORE applying any of the set's
    // migrations, then applies them all inside ONE transaction —
    // `drizzle-orm@0.45.2/pg-core/dialect.js:54-60`, with `migrationsSchema: "public"` set at
    // `packages/db/src/migrate.ts:42`, which is the schema this probe looks in. So an `instance`
    // interrupted inside the LAST set leaves all five journals present and zero of that set's
    // migrations applied. That much has not changed, and a line reading "applied" would still claim
    // a certainty the read cannot support.
    //
    // What HAS changed is the remedy. `planInstance` no longer gates `migrate` on journal presence,
    // so re-running `instance` repairs exactly this state. The report used to send the operator to
    // the host's next boot instead, because it was the only thing that would fix it.
    const text = formatStatus(PROVISIONED).join("\n");
    expect(text).toContain("migration set core: journal present");
    expect(text).toContain("migration set scheduler: journal absent");
    expect(text).toContain("was started, not that it finished");
    // The remedy, and the retired claim. Asserting the OLD sentence is gone matters as much as
    // asserting the new one is present: this text is printed to an operator, and a stale
    // "instance plans a migrate only when a journal is MISSING" would send them somewhere else.
    expect(text).toContain("waitron-provision instance");
    expect(text).not.toMatch(/only when a journal is MISSING/i);
  });

  it("says the database is absent and stops there", () => {
    const text = formatStatus({
      database: "waitron",
      databaseExists: false,
      roles: {},
      inside: null,
    }).join("\n");
    expect(text).toMatch(/database.*absent/i);
    // Nothing inside a database that does not exist is observable, so claiming "0 migration sets
    // applied" would be a statement about a thing that was never read.
    expect(text).not.toMatch(/migration/i);
  });

  it("prints no password, no connection string and no key", () => {
    // As written against `PROVISIONED` alone, the assertion below is vacuous: `InstanceState`
    // (packages/provisioning/src/instance-state.ts) has no field that could hold a secret — a
    // database name, a role name, a migration-set name and a deployment stamp are all it carries
    // — so a formatter that faithfully echoes its input passes this regardless of whether it does
    // any filtering at all. Padding the fixture with a `memberOf` entry or a database name that
    // contains one of the forbidden substrings does not fix this: those fields are SUPPOSED to be
    // printed (that is what "names every role" above tests), so making one of them contain
    // "password" would fail the guard for the wrong reason — a coincidental substring match on
    // legitimate, non-secret data — not because a real secret leaked. The only place a genuine
    // secret could plausibly leak from, given `formatStatus`'s signature takes just the state, is
    // the formatter reaching past its parameter into `process.env` (e.g. a well-meaning "also show
    // the active key version" addition). That is what the second assertion below rules out: it
    // plants a marker in the one env var this repo treats as secret and confirms it does not reach
    // the output. Verified against two real mutants, not just reasoned about: a
    // `` `WAITRON_CREDENTIALS_KEY=${process.env.WAITRON_CREDENTIALS_KEY}` `` line was already caught
    // by the FIRST assertion's literal substring, so it alone would not have proven this one earns
    // its keep — but a `` `debug hint: ${process.env.WAITRON_CREDENTIALS_KEY}` `` line slipped past
    // that regex entirely and was caught only by the `not.toContain(marker)` line below.
    const marker = "sk_test_marker_should_not_appear_in_status_output";
    const previous = process.env.WAITRON_CREDENTIALS_KEY;
    process.env.WAITRON_CREDENTIALS_KEY = marker;
    try {
      const text = formatStatus(PROVISIONED).join("\n");
      expect(text).not.toMatch(/postgres:\/\/|password|WAITRON_CREDENTIALS_KEY=/i);
      expect(text).not.toContain(marker);
    } finally {
      if (previous === undefined) {
        delete process.env.WAITRON_CREDENTIALS_KEY;
      } else {
        process.env.WAITRON_CREDENTIALS_KEY = previous;
      }
    }
  });
});
