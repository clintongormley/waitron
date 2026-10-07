import { compareDecimal, decimal } from "./money.js";

export function compareLabels(a: string, b: string): number {
  const left = a.match(/\d+(?:[.,]\d+)?|\D+/g) ?? [];
  const right = b.match(/\d+(?:[.,]\d+)?|\D+/g) ?? [];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index]!;
    const y = right[index]!;
    const numbers = /^\d/.test(x) && /^\d/.test(y);
    const compared = numbers
      ? compareDecimal(
          decimal(x.replace(",", ".").replace(/^0+(?=\d)/, "")),
          decimal(y.replace(",", ".").replace(/^0+(?=\d)/, "")),
        )
      : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    if (compared !== 0)
      return numbers
        ? compared
        : left.slice(index).join("").localeCompare(right.slice(index).join(""), undefined, {
            numeric: true,
            sensitivity: "base",
          });
  }
  return left.length - right.length;
}
