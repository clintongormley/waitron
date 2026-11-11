import { changeSubscriber, type LiveEvents } from "./live-api.js";
import type { Logger } from "./logger.js";

export function publishState(bus: LiveEvents, type: string, log: Logger): void {
  changeSubscriber(bus, log)({ resources: [{ type }] });
}
