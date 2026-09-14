/** Which alerts are new since this tab's previous read. The first read raises nothing, so opening
 * the dashboard does not pop up everything already open. */
export class AlertArrivals {
  #previous: ReadonlySet<string> | null = null;

  next<T extends { key: string }>(alerts: readonly T[]): T[] {
    const previous = this.#previous;
    this.#previous = new Set(alerts.map((alert) => alert.key));
    return previous === null ? [] : alerts.filter((alert) => !previous.has(alert.key));
  }

  reset(): void {
    this.#previous = null;
  }
}
