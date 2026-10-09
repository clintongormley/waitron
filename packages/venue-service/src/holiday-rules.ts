/** Cities compare after NFC, trimmed with inner whitespace collapsed, and lowercased. */
export function holidayCityKey(city: string): string {
  return city.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}
