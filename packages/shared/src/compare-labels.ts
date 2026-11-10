import { compareDecimal, decimal, type Decimal } from "./money.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const collators = new Map<string | undefined, Intl.Collator>([[undefined, collator]]);

function collatorFor(language?: string): Intl.Collator {
  const key = language || undefined;
  let result = collators.get(key);
  if (result === undefined) {
    try {
      result = new Intl.Collator(key, { numeric: true, sensitivity: "base" });
    } catch {
      result = collator;
    }
    collators.set(key, result);
  }
  return result;
}

type LabelKey = { parts: string[]; numbers: (Decimal | null)[] };

function labelKey(label: string): LabelKey {
  const parts = label.match(/\d+(?:[.,]\d+)?|\D+/g) ?? [];
  return {
    parts,
    numbers: parts.map((part) =>
      /^\d/.test(part) ? decimal(part.replace(",", ".").replace(/^0+(?=\d)/, "")) : null,
    ),
  };
}

function compareKeys(left: LabelKey, right: LabelKey, collator: Intl.Collator): number {
  for (let index = 0; index < Math.min(left.parts.length, right.parts.length); index++) {
    const x = left.numbers[index]!;
    const y = right.numbers[index]!;
    const numbers = x !== null && y !== null;
    const compared = numbers
      ? compareDecimal(x, y)
      : collator.compare(left.parts[index]!, right.parts[index]!);
    if (compared !== 0)
      return numbers
        ? compared
        : collator.compare(left.parts.slice(index).join(""), right.parts.slice(index).join(""));
  }
  return left.parts.length - right.parts.length;
}

export function compareLabels(a: string, b: string, language?: string): number {
  return compareKeys(labelKey(a), labelKey(b), collatorFor(language));
}

/** Keep the name cache within one sort so changed lists do not retain old keys. */
export function createLabelComparator(language?: string): (a: string, b: string) => number {
  const collator = collatorFor(language);
  const keys = new Map<string, LabelKey>();
  const keyFor = (label: string): LabelKey => {
    let key = keys.get(label);
    if (key === undefined) {
      key = labelKey(label);
      keys.set(label, key);
    }
    return key;
  };
  return (a, b) => compareKeys(keyFor(a), keyFor(b), collator);
}
