import { firstCodeInCauseChain } from "./cause-chain.js";

/** Five characters, `[0-9A-Z]` — the shape SQLSTATE is defined to have. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The SQLSTATE of a driver failure, or `null` when there is none to be had.
 *
 * Nothing but a five-character `[0-9A-Z]` string ever leaves this function, and that is the entire
 * argument for printing its result into an operator's terminal. It is STRUCTURAL, not a promise
 * about who calls it: a generated password is 32 base64url characters (identifiers.ts) and a
 * connection string is longer still, so neither can satisfy the pattern. A non-SQLSTATE error code
 * that happens to match — Node's `EPIPE` is five upper-case characters — would pass this filter,
 * and is equally not a secret; the filter is a shape guard, not an identification.
 *
 * The `.cause` walk it is built on lives in `cause-chain.ts`, which carries the depth and
 * self-reference arguments. That the code IS down that chain rather than on the caught error is
 * asserted against the real shape, not assumed — `instance-apply.pg.test.ts`'s "never lets the
 * generated password reach a thrown error" forces a genuine failure through a real container and
 * pins `sqlState: "42704"`, which is only reachable through the walk.
 *
 * It lives in `@waitron/shared` rather than beside either of its callers because both
 * `@waitron/provisioning` (which classifies a failed READ or WRITE — `cli.ts` / `instance-apply.ts`)
 * and `@waitron/sync` (which classifies a failed `CREATE SUBSCRIPTION`) need exactly this, and the
 * safety argument above is the kind that must not be maintained in two copies.
 */
export function sqlStateOf(error: unknown): string | null {
  return firstCodeInCauseChain(error, (code) => SQLSTATE.test(code));
}
