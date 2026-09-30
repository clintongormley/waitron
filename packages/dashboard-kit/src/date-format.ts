/** An ISO-8601 instant as `YYYY-MM-DD HH:MM` in the BROWSER's local timezone, not UTC: an operator
 * reads it against the clock on the wall. */
export function formatIsoMinute(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
