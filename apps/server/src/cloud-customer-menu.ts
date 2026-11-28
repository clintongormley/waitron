import type { CloudConnectionStatus } from "./cloud-client.js";
import type { SavedCloudState } from "./cloud-client-types.js";
import { remoteAccessListed, validStaffHostname } from "./cloud-tunnel.js";

export type CustomerMenuCloudStatus =
  | { status: "ready"; origin: string }
  | { status: "disconnected" | "remote_off" | "plan_required" | "waiting" | "unavailable" };

export function projectCustomerMenuCloudStatus(
  environment: "test" | "production",
  state: SavedCloudState | undefined,
  view: CloudConnectionStatus,
): CustomerMenuCloudStatus {
  if (environment !== "test") return { status: "unavailable" };
  if (!view.registration) return { status: "disconnected" };
  if (view.remoteAccessEnabled === false) return { status: "remote_off" };
  if (view.remoteAccessPlanRequired) return { status: "plan_required" };
  const service = state?.lifecycle?.view?.services.find(
    ({ service }) => service === "remote_access",
  );
  if (
    view.installation?.state !== "active" ||
    !remoteAccessListed(state) ||
    service?.state !== "ready"
  )
    return { status: "waiting" };
  const { publicHostname } = service.configuration;
  return validStaffHostname(publicHostname)
    ? { status: "ready", origin: `https://${publicHostname}` }
    : { status: "waiting" };
}
