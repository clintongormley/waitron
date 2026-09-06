/**
 * Vitest-FREE SQL identifier + role-statement helpers.
 *
 * These live apart from `lifecycle.ts` for one concrete reason: `shared-container.ts` uses them, and
 * `shared-container.ts` is imported from a package's vitest `globalSetup`. A globalSetup module that
 * (transitively) imports `vitest` dies at module load with `Error: Vitest failed to access its
 * internal state` before any test runs — `lifecycle.ts` imports `vitest` for `beforeAll`/`afterAll`,
 * so pulling these out of it is what keeps `shared-container.ts`'s import graph clean of `vitest`.
 * Found the hard way on 2026-08-19: the foundation's own tests passed (they run as ordinary test
 * files, where `vitest` IS available), and the fault surfaced only when a real globalSetup imported
 * `startSharedContainer`. `lifecycle.ts` re-exports these so existing importers are unaffected.
 */

export interface ProbeRole {
  name: string;
  password: string;
  /**
   * One membership, or several. `["app_user", "pg_monitor"]` emits `in role app_user, pg_monitor`
   * — valid PostgreSQL, and how a role that must belong to more than one group is expressed without
   * an out-of-band grant.
   */
  inRole?: string | readonly string[];
}

/** Conservative, and deliberately narrower than SQL allows: what a test fixture actually uses. */
const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The `create role` a probing suite needs. Extracted so both branches are testable without a
 * container — the alternative is a Docker-gated test for one string.
 *
 * **Validates rather than escapes**, unlike `packages/provisioning/src/identifiers.ts`, which quotes
 * because it handles generated passwords and operator-supplied names. Here every value is a literal
 * in a test fixture, so a token that needs escaping is a mistake worth failing on rather than
 * accommodating. That package's `quoteIdent`/`quoteLiteral` are not reused because `@waitron/db`
 * cannot depend on `@waitron/provisioning` — the dependency runs the other way — and copying them
 * would make a fourth divergent copy of a helper this repo has already had trouble keeping in sync.
 *
 * The point is the same one that file makes: these fields are typed plain `string` on an exported
 * interface, so "callers only pass safe values" was a property of the callers, not of the code.
 */
export function probeRoleStatement(probe: ProbeRole): string {
  const inRoles =
    probe.inRole === undefined
      ? []
      : typeof probe.inRole === "string"
        ? [probe.inRole]
        : probe.inRole;
  for (const [field, value] of [
    ["name", probe.name],
    ["password", probe.password],
  ] as const) {
    if (!SAFE_TOKEN.test(value)) {
      throw new Error(`probeRoleStatement: unsafe ${field} ${JSON.stringify(value)}`);
    }
  }
  for (const role of inRoles) {
    if (!SAFE_TOKEN.test(role)) {
      throw new Error(`probeRoleStatement: unsafe inRole ${JSON.stringify(role)}`);
    }
  }
  const inRole = inRoles.length === 0 ? "" : ` in role ${inRoles.join(", ")}`;
  return `create role ${probe.name} login password '${probe.password}'${inRole}`;
}

/**
 * Validates a generated SQL identifier — a template or clone DATABASE name — against the same
 * {@link SAFE_TOKEN} {@link probeRoleStatement} uses, and for the same reason. These reach
 * `CREATE DATABASE` / `DROP DATABASE`, which are UTILITY statements PostgreSQL will not bind a
 * placeholder into (verified against a real server on 2026-07-31: `create role $1` is a syntax
 * error; the same holds for `create database $1`), so the name arrives as text or not at all. Every
 * name this module builds is internal (`template_<key>`, `clone_<pid>_<n>`), so a token that needs
 * escaping is a bug worth failing on — validate-and-throw, never `quoteIdent`, which `@waitron/db`
 * could not import anyway (the provisioning package that owns it depends the other way).
 */
export function assertSafeIdentifier(kind: string, value: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new Error(`assertSafeIdentifier: unsafe ${kind} ${JSON.stringify(value)}`);
  }
  return value;
}
