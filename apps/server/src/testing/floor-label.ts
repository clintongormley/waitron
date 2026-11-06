let nextSuffix = 0;

export function floorLabelSuffix(): string {
  return String(++nextSuffix);
}
