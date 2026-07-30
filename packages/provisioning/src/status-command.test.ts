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
      bypassRls: false,
      memberOf: ["app_user"],
    },
    waitron_app: {
      canLogin: true,
      createRole: false,
      superuser: false,
      bypassRls: false,
      memberOf: ["app_user"],
    },
  },
  inside: { migratedSets: ["core", "fiscal"], stamp: "preproduction" },
};

describe("formatStatus", () => {
  it("names every role, present or absent", () => {
    const text = formatStatus(PROVISIONED).join("\n");
    expect(text).toContain("waitron_migrator");
    expect(text).toContain("waitron_app");
    // The ABSENT one is the useful line: a status that listed only what exists would leave an
    // operator to remember what the full set is.
    expect(text).toMatch(/waitron_provisioner.*absent/);
  });

  it("reports the stamp", () => {
    expect(formatStatus(PROVISIONED).join("\n")).toContain("preproduction");
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
