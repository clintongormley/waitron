export function popupIndex(key: string, current: number, count: number): number | undefined {
  const last = count - 1;
  const at = Math.min(current, last);
  switch (key) {
    case "ArrowDown":
      return count === 0 ? -1 : (at + 1) % count;
    case "ArrowUp":
      return at <= 0 ? last : at - 1;
    case "Home":
      return count > 0 ? 0 : -1;
    case "End":
      return last;
    default:
      return undefined;
  }
}
