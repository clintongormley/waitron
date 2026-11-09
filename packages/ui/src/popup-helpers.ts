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

export function popupPlacement(
  anchor: { top: number; bottom: number },
  height: number,
  viewportHeight: number,
  mode: "fit" | "below" | "above",
): { top: number; maxHeight: number } {
  const below = Math.max(0, viewportHeight - anchor.bottom - 8);
  const above = Math.max(0, anchor.top - 8);
  if (mode === "above" && height > below && above > below)
    return { top: Math.max(8, anchor.top - height), maxHeight: above };
  if (mode !== "fit") return { top: anchor.bottom, maxHeight: below };
  const maxHeight = Math.max(0, viewportHeight - 16);
  return { top: Math.max(8, Math.min(anchor.bottom, viewportHeight - height - 8)), maxHeight };
}
