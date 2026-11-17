export function parseAcceptLanguage(
  header: string | undefined,
): { range: string; weight: number; index: number }[] {
  return (header ?? "")
    .split(",")
    .flatMap((entry, index) => {
      const match =
        /^\s*([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(
          entry,
        );
      if (!match) return [];
      return [{ range: match[1]!.toLowerCase(), weight: Number(match[2] ?? 1), index }];
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
}
