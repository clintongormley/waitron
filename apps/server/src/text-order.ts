/** Code-point order, which is the order of the UTF-8 bytes the database's binary collation
 *  compares. Plain `<` compares UTF-16 code units, which puts a character above U+FFFF before one
 *  from U+E000 to U+FFFF. */
export function byText(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a.charCodeAt(index);
    const right = b.charCodeAt(index);
    if (left !== right) return codePointRank(left) - codePointRank(right);
  }
  return a.length - b.length;
}

/** A code unit's place in code-point order: surrogates, which only encode characters above
 *  U+FFFF, move above U+E000–U+FFFF. */
const codePointRank = (unit: number) =>
  unit < 0xd800 ? unit : unit < 0xe000 ? unit + 0x2000 : unit - 0x800;
