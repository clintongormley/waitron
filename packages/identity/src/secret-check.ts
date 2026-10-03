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

interface IssuedCheck extends SecretCheck {
  readonly secret: string;
  readonly derivedAgainst: DerivedAgainst;
}

const issued = new WeakSet<SecretCheck>();

export function issueCheck(check: IssuedCheck): SecretCheck {
  // Not enumerable, so `JSON.stringify` of a check leaves the secret out.
  const frozen = Object.freeze(
    Object.defineProperties(
      { personId: check.personId, matches: check.matches },
      {
        secret: { value: check.secret, enumerable: false },
        derivedAgainst: { value: check.derivedAgainst, enumerable: false },
      },
    ),
  );
  issued.add(frozen);
  return frozen;
}

/** The check's verdict when it may stand in for deriving the key, else undefined. */
export function trustedVerdict(
  checked: SecretCheck | undefined,
  personId: string | null,
  secret: string,
  derivedAgainst: DerivedAgainst,
): boolean | undefined {
  if (checked === undefined || !issued.has(checked)) return undefined;
  const {
    personId: checkedPerson,
    secret: checkedSecret,
    derivedAgainst: checkedAgainst,
    matches,
  } = checked as IssuedCheck;
  if (checkedPerson !== personId || checkedSecret !== secret || checkedAgainst !== derivedAgainst) {
    return undefined;
  }
  return matches;
}
