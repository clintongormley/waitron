const MASK = "***";

/**
 * A piece keeps its first and last character around a fixed `***`, so its length is not shown; a
 * piece of three characters or fewer is `***` alone. Characters are code points, so an astral first
 * or last letter is never cut in half.
 */
function maskPiece(piece: string): string {
  const characters = [...piece];
  return characters.length <= 3 ? MASK : `${characters[0]}${MASK}${characters.at(-1)}`;
}

/** Each word masked on its own and joined by one space, so the original spacing is not shown. */
function maskName(value: string): string {
  const words = value.split(/\s+/u).filter((word) => word !== "");
  return words.length === 0 ? MASK : words.map(maskPiece).join(" ");
}

// The ending after the domain's last dot is written as it is, so it must look like a top-level
// domain; anything else under an email key is masked as one piece.
const EMAIL_SHAPE = /^([^@\s]+)@([^@\s]+)\.(\p{L}+)$/u;

function maskEmail(value: string): string {
  const parts = EMAIL_SHAPE.exec(value);
  if (parts === null) return maskPiece(value);
  const [, local, domain, ending] = parts;
  return `${maskPiece(local!)}@${maskPiece(domain!)}.${ending!}`;
}

// Details that name a person, masked in every line the server's logger writes; scripts/personal-log-params.test.ts guards the list.
// A tax number is masked as one piece.
const PERSONAL_LOG_RULES: ReadonlyMap<string, (value: string) => string> = new Map([
  ["email", maskEmail],
  ["displayName", maskName],
  ["ownerName", maskName],
  ["editorName", maskName],
  ["holderPersonName", maskName],
  ["person", maskName],
  ["supplierTaxId", maskPiece],
  ["legalName", maskName],
  ["taxId", maskPiece],
  ["idEmisorFactura", maskPiece],
  ["todayName", maskName],
]);

export const PERSONAL_LOG_KEYS: ReadonlySet<string> = new Set(PERSONAL_LOG_RULES.keys());

export const PERSONAL_LOG_PATHS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["merchants", new Set(["name"])],
]);

// Anything but a string is `***` whole: nothing inside it is looked at.
function masked(value: unknown, rule: (value: string) => string): unknown {
  if (value === null || value === undefined) return value;
  return typeof value === "string" ? rule(value) : MASK;
}

export function maskPersonalData(key: string, value: unknown): unknown {
  const rule = PERSONAL_LOG_RULES.get(key);
  if (rule !== undefined) {
    // A function or symbol stays out of the text, as plain JSON leaves it, so `stringifyMasked`'s
    // test for the key in the unmasked text agrees with this replacer.
    if (typeof value === "function" || typeof value === "symbol") return value;
    return masked(value, rule);
  }
  const children = PERSONAL_LOG_PATHS.get(key);
  if (children === undefined || !Array.isArray(value)) return value;
  return value.map((element: unknown) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
    const copy: Record<string, unknown> = { ...(element as Record<string, unknown>) };
    for (const child of children) copy[child] = masked(copy[child], maskName);
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
