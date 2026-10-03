/** Stands for "derived against the dummy hash": distinct from every stored hash, null included. */
export const DUMMY = Symbol("dummy derivation");

export type DerivedAgainst = string | typeof DUMMY;

/**
 * The verdict of a PIN or password check taken before the transaction opened. A verifier inside the
 * transaction trusts it only if this package issued it for the same person and secret, against the
 * same hash the verifier would derive against there (the dummy hash for a row that cannot sign
 * in); otherwise it derives the key itself, as it would without one.
 */
export interface SecretCheck {
  /** The person whose row the check read; null when no row matched. */
  readonly personId: string | null;
  /** True only when the row could sign in and the secret matched its hash. */
  readonly matches: boolean;
}

interface CheckedAgainst {
  readonly secret: string;
  readonly derivedAgainst: DerivedAgainst;
}

// Only an object held here is trusted, and the secret is kept here rather than on the check.
const issued = new WeakMap<SecretCheck, CheckedAgainst>();

export function issueCheck(check: SecretCheck & CheckedAgainst): SecretCheck {
  const verdict = Object.freeze({ personId: check.personId, matches: check.matches });
  issued.set(verdict, { secret: check.secret, derivedAgainst: check.derivedAgainst });
  return verdict;
}

/** The check's verdict when it may stand in for deriving the key, else undefined. */
export function trustedVerdict(
  checked: SecretCheck | undefined,
  personId: string | null,
  secret: string,
  derivedAgainst: DerivedAgainst,
): boolean | undefined {
  if (checked === undefined) return undefined;
  const against = issued.get(checked);
  if (
    against === undefined ||
    checked.personId !== personId ||
    against.secret !== secret ||
    against.derivedAgainst !== derivedAgainst
  ) {
    return undefined;
  }
  return checked.matches;
}
