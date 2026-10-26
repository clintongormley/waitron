// Details that name a person, masked in every line the server's logger writes; scripts/personal-log-params.test.ts guards the list.
export const PERSONAL_LOG_KEYS: ReadonlySet<string> = new Set([
  "email",
  "displayName",
  "ownerName",
  "editorName",
  "holderPersonName",
  "person",
  "supplierTaxId",
  "legalName",
  "taxId",
  "idEmisorFactura",
  "todayName",
]);

export const PERSONAL_LOG_PATHS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["merchants", new Set(["name"])],
]);

const MASK = "***";

export function maskPersonalData(key: string, value: unknown): unknown {
  if (PERSONAL_LOG_KEYS.has(key)) {
    // A function or symbol stays out of the text, as plain JSON leaves it, so `stringifyMasked`'s
    // test for the key in the unmasked text agrees with this replacer.
    if (typeof value === "function" || typeof value === "symbol") return value;
    return value === null || value === undefined ? value : MASK;
  }
  const children = PERSONAL_LOG_PATHS.get(key);
  if (children === undefined || !Array.isArray(value)) return value;
  return value.map((element: unknown) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
    const copy: Record<string, unknown> = { ...(element as Record<string, unknown>) };
    for (const child of children) {
      if (copy[child] !== null && copy[child] !== undefined) copy[child] = MASK;
    }
    return copy;
  });
}

const PERSONAL_KEY_TEXT = new RegExp(
  `"(?:${[...PERSONAL_LOG_KEYS, ...PERSONAL_LOG_PATHS.keys()]
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})":`,
);

/**
 * `JSON.stringify(value, maskPersonalData)` without the replacer's cost on a line that carries no
 * listed key: every key a JSON text holds appears in it as `"key":`, so a text without one needed
 * no masking. A line that matches is serialised a second time, so a
 * getter or `toJSON` that answers differently on each call can make the two passes disagree.
 */
export function stringifyMasked(value: unknown): string {
  let plain: string;
  try {
    plain = JSON.stringify(value);
  } catch {
    // A BigInt or a cycle under a listed key serialises once the replacer has masked it.
    return JSON.stringify(value, maskPersonalData);
  }
  return PERSONAL_KEY_TEXT.test(plain) ? JSON.stringify(value, maskPersonalData) : plain;
}
