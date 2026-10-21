import { applyVenueTheme, readVenueTheme } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";

export function repaintVenueTheme(api: DashboardApi): void {
  void readVenueTheme(() => api.getVenueTheme()).then(
    ({ answer, sentAt }) => applyVenueTheme(answer, sentAt),
    // The shell's live read follows the same change, so a failed read here costs only the wait.
    () => {},
  );
}
