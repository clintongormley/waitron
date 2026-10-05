export interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}

/** Shorter than the dashboard's ten minutes before a report shows as old, so a steady reading is
 * stored again before then while sends are answered; longer than the server's one minute between
 * stored reports, so a steady re-send is not dropped as too soon. */
const RESEND_INTERVAL_MS = 5 * 60_000;

/** Shorter than {@link RESEND_INTERVAL_MS}, so a send that is never answered cannot hold back the
 * next re-send. */
const SEND_LIMIT_MS = 60_000;

/** Reports the battery where the browser exposes it (Chromium-based browsers, over HTTPS): on start,
 * on each change, and every five minutes counted from the first report, which a change does not
 * restart. One send at a time, given up after a minute: a change or a re-send due while a send is
 * out sends the battery's reading as it is when that send settles or is given up. */
export function startBatteryReport(
  send: (report: { level: number; charging: boolean }, signal: AbortSignal) => Promise<void>,
  getBattery: (() => Promise<BatteryLike>) | undefined,
): { stop(): void } {
  let stopped = false;
  let stopReporting = (): void => undefined;
  if (getBattery !== undefined)
    Promise.resolve()
      .then(getBattery)
      .then((battery) => {
        if (stopped) return;
        let inFlight:
          { request: AbortController; limit: ReturnType<typeof setTimeout> } | undefined;
        let pending = false;
        const report = (): void => {
          if (inFlight !== undefined) {
            pending = true;
            return;
          }
          pending = false;
          const request = new AbortController();
          const settled = (): void => {
            if (inFlight?.request !== request) return;
            clearTimeout(inFlight.limit);
            inFlight = undefined;
            if (pending) report();
          };
          const limit = setTimeout(() => {
            request.abort();
            settled();
          }, SEND_LIMIT_MS);
          inFlight = { request, limit };
          const value = { level: Math.round(battery.level * 100), charging: battery.charging };
          let answered: Promise<void>;
          // A `send` that throws rather than rejects would be an uncaught error from an event listener.
          try {
            answered = send(value, request.signal).catch(() => undefined);
          } catch {
            answered = Promise.resolve();
          }
          void answered.then(settled);
        };
        battery.addEventListener("levelchange", report);
        battery.addEventListener("chargingchange", report);
        const resend = setInterval(report, RESEND_INTERVAL_MS);
        stopReporting = () => {
          battery.removeEventListener("levelchange", report);
          battery.removeEventListener("chargingchange", report);
          clearInterval(resend);
          if (inFlight !== undefined) {
            clearTimeout(inFlight.limit);
            inFlight.request.abort();
            inFlight = undefined;
          }
        };
        report();
      })
      .catch(() => undefined);
  return {
    stop() {
      stopped = true;
      stopReporting();
    },
  };
}
