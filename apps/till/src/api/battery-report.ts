export interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}

/** Reports the battery where the browser exposes it (Chromium-based browsers, over HTTPS). The
 * server stores at most one report a minute, so every change is sent. */
export function startBatteryReport(
  send: (report: { level: number; charging: boolean }) => Promise<void>,
  getBattery: (() => Promise<BatteryLike>) | undefined,
): { stop(): void } {
  let stopped = false;
  let stopListening = (): void => undefined;
  if (getBattery !== undefined)
    void getBattery()
      .then((battery) => {
        if (stopped) return;
        const report = (): void => {
          void send({
            level: Math.round(battery.level * 100),
            charging: battery.charging,
          }).catch(() => undefined);
        };
        battery.addEventListener("levelchange", report);
        battery.addEventListener("chargingchange", report);
        stopListening = () => {
          battery.removeEventListener("levelchange", report);
          battery.removeEventListener("chargingchange", report);
        };
        report();
      })
      .catch(() => undefined);
  return {
    stop() {
      stopped = true;
      stopListening();
    },
  };
}
