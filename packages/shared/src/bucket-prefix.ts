export function normalisePrefix(prefix: string): string {
  let start = 0;
  let end = prefix.length;
  while (start < end && prefix[start] === "/") start++;
  while (end > start && prefix[end - 1] === "/") end--;
  const trimmed = prefix.slice(start, end);
  return trimmed === "" ? "" : `${trimmed}/`;
}
