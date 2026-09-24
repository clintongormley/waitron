/** Today in UTC, so near midnight it can name a different day than the venue's. A copy of the app's
 * `today`: this sub-path imports nothing from the app. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
