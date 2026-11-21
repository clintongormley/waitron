/** The dashboard's Servers screen on the main box, or nothing for an address that is not a URL. */
export function serversPageOf(typed: string): string | undefined {
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:"
    ? `${url.origin}/servers`
    : undefined;
}
