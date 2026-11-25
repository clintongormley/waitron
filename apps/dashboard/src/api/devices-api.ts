import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import type { DashboardApi } from "./client.js";
import { KitchenApi } from "./kitchen-api.js";

export interface DeviceRow {
  id: string;
  madeHereStationIds: string[];
  /** The profiles staff may switch the device to: its active profile first, then the others. */
  approvedProfileIds: string[];
  kind: string;
  kitchenScreens: ResolvedKitchenScreen[];
  label: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
  deviceProfileId: string | null;
  /** The profile was deleted while only disabled devices held it. */
  profileRetired: boolean;
  /** The device's own choice; null is Use default, which `equipment` resolves. */
  receiptPrinterId: string | null;
  paymentSlipPrinterId: string | null;
  cashDrawerPrinterId: string | null;
  /** Each role's choice and what it resolves to now: receipt, slip, drawer, invoice, then reader.
   * The invoice role's `chosenId` is the device's own invoice choice, which the row has no field for. */
  equipment: RoleEquipment[];
  /** A whole percentage, 0 to 100. */
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  batteryReportedAt: string | null;
}

export type EquipmentRole =
  "receipt" | "payment_slip" | "cash_drawer" | "invoice" | "card_terminal";
/** The other device holding an item, and who is signed in on it, if anyone. */
export interface EquipmentHolder {
  deviceId: string;
  deviceName: string;
  personName: string | null;
}

export interface RoleEquipment {
  role: EquipmentRole;
  selection: "default" | "item";
  chosenId: string | null;
  /** What the role prints, opens or pays on now; null is None. */
  resolved: { id: string; name: string; available: boolean } | null;
}

export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";
/** Where a profile serves; `allowedZoneIds` null is every zone of the department. */
export interface ProfileServiceScope {
  departmentId: string | null;
  allowedZoneIds: string[] | null;
  startingZoneId: string | null;
}

export interface DeviceProfile extends ProfileServiceScope {
  id: string;
  name: string;
  capabilities: string[];
  formFactor: FormFactor;
  inactivityTimeoutSeconds: number | null;
  /** `null` selects the fixed home screen. */
  startingScreen: string | null;
  receiptPrinterIds: string[];
  paymentSlipPrinterIds: string[];
  cashDrawerPrinterIds: string[];
  /** Each list's default, which a device on Use default resolves; null is None. */
  receiptPrinterDefaultId: string | null;
  paymentSlipPrinterDefaultId: string | null;
  cashDrawerPrinterDefaultId: string | null;
  /** Receipt printers and A4 printers alike. */
  invoicePrinterIds: string[];
  invoicePrinterDefaultId: string | null;
  admittedStaffRoleIds: string[];
}
/** What a profile save may also carry; each part left out stays as stored on an edit. */
export type ProfileSaveExtras = Partial<
  { kitchenScreens: ProfileKitchenScreens } & ProfileServiceScope &
    ProfileEquipmentDefaults &
    Pick<DeviceProfile, "startingScreen" | "admittedStaffRoleIds">
>;
/** The drawer and invoice lists and each printer list's default; on a new profile, absent is empty
 * and None. */
export type ProfileEquipmentDefaults = Pick<
  DeviceProfile,
  | "cashDrawerPrinterIds"
  | "invoicePrinterIds"
  | "receiptPrinterDefaultId"
  | "paymentSlipPrinterDefaultId"
  | "cashDrawerPrinterDefaultId"
  | "invoicePrinterDefaultId"
>;
/** The card readers a profile's devices may choose, in order, and the one they start on. */
export interface ProfileReaderList {
  readerIds: string[];
  defaultReaderId: string | null;
}
/** The departments and their zones a profile can be given, switched-off ones included. */
export interface ProfileScopeChoices {
  departments: { id: string; name: string; active: boolean }[];
  zones: { id: string; name: string; departmentId: string; active: boolean }[];
}

export const KITCHEN_SCREEN_KINDS = ["station", "pass", "pass_monitor"] as const;

export type KitchenScreenKind = (typeof KITCHEN_SCREEN_KINDS)[number];

export type PassKind = Exclude<KitchenScreenKind, "station">;
/** null is every station or every zone; a station screen has no zones and is always null. */
export interface KitchenScreenScope {
  stationIds: string[] | null;
  zoneIds: string[] | null;
}
/**
 * The kitchen screens a profile's devices may run, by kind. A kitchen display is offered only the
 * kinds listed; on a till or handheld a missing station or pass screen bounds nothing, while a pass
 * monitor is offered only when listed.
 */
export type ProfileKitchenScreens = Partial<Record<KitchenScreenKind, ProfileKitchenScreen>>;
/** A pass or pass monitor entry carries whether the pass shows other stations' dishes; absent on
 * a write keeps what is stored, or true for a new entry. A station entry never carries it. */
export interface ProfileKitchenScreen extends KitchenScreenScope {
  showNonPassStations?: boolean;
}

export interface DeviceKitchenScreen extends KitchenScreenScope {
  kind: KitchenScreenKind;
}
/** One station or zone of a device's kitchen screen: shown, or no longer available. */
export interface ScreenSlot {
  id: string;
  name: string;
  available: boolean;
  switchedOff: boolean;
}
/** A device's kitchen screen as the server reads it back. */
export interface ResolvedKitchenScreen {
  kind: KitchenScreenKind;
  available: boolean;
  everyStation: boolean;
  /** As `everyStation`, for zones; a station screen's is true. */
  everyZone: boolean;
  /** Display order, the device's own list or else what its profile allows it. */
  stations: ScreenSlot[];
  /** null: no zone filter. */
  zones: ScreenSlot[] | null;
  showNonPassStations: boolean;
}
/** In the order the device's equipment choices offer them. */
export type ProfilePrinterLists = Pick<
  DeviceProfile,
  "receiptPrinterIds" | "paymentSlipPrinterIds"
>;
/** Carries no verification number, deliberately: the list must never show the answer beside the
 * question. `label` is the name the joiner asked for, so it is untrusted text. */
export interface JoinRequestRow {
  id: string;
  kind: "device" | "print_agent";
  label: string;
  createdAt: string;
  /** Print agents only, when this request follows an explicit denial. */
  previouslyDenied?: true;
  /** Device rows only: the manager whose number check claimed the request, if any. */
  pairingBy?: { name: string; mine: boolean } | null;
  /** Device rows only: set when the knock came from a disabled device's browser, which proved it is
   * that device. The request's `id` is then the device's own id, and accepting it enables that
   * device again rather than adding one. */
  returning?: ReturningDetails | null;
}
/**
 * What a returning device's disabled row holds, and whether its profile was retired, for the Pair
 * step to start from.
 */
export interface ReturningDetails {
  name: string;
  profileId: string;
  kitchenScreens: ResolvedKitchenScreen[];
  /** Its profile was deleted, so Enable must be given another. */
  profileRetired: boolean;
}
/** `deviceAddress` is the address the server advertises to the venue's devices, not this tab's. */
export interface PairingModeState {
  open: boolean;
  openUntil: string | null;
  deviceAddress: string;
  /** The venue's time zone, or UTC when the venue has none the server's runtime knows. */
  timeZone: string;
}
/**
 * Safe to give up on: an accept that went through drops this login's claim, so a re-sent one is
 * refused `join_request.unclaimed` (the device accept route, apps/server/src/join-api.ts), whose
 * message points at the device list.
 */
const DEVICE_ACCEPT_LIMIT_MS = 30_000;

export class DevicesApi extends KitchenApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  async getProfileScopeChoices(): Promise<ProfileScopeChoices> {
    const venue = await this.#request<ProfileScopeChoices>(
      "/management-api/venue-service/departments-and-zones",
      "GET",
    );
    return {
      departments: venue.departments.map(({ id, name, active }) => ({ id, name, active })),
      zones: venue.zones.map(({ id, name, departmentId, active }) => ({
        id,
        name,
        departmentId,
        active,
      })),
    };
  }
  // ── Devices ────────────────────────────────────────────────────────────────────────────────────

  listDevices(): Promise<DeviceRow[]> {
    return this.#request<DeviceRow[]>("/management-api/devices", "GET");
  }
  // ── Pairing mode + join requests ───────────────────────────────────────────────────────────────

  pairingMode(): Promise<PairingModeState> {
    return this.#request<PairingModeState>("/management-api/pairing-mode", "GET");
  }
  takePairingHold(): Promise<{ holdId: string; openUntil: string }> {
    return this.#request<{ holdId: string; openUntil: string }>(
      "/management-api/pairing-mode/holds",
      "POST",
    );
  }
  /** The route leaves the session's idle clock alone; call it through `background`. */
  renewPairingHold(holdId: string): Promise<{ openUntil: string }> {
    return this.#request<{ openUntil: string }>(
      `/management-api/pairing-mode/holds/${holdId}/renew`,
      "POST",
    );
  }
  releasePairingHold(holdId: string): Promise<void> {
    return this.#request<void>(`/management-api/pairing-mode/holds/${holdId}`, "DELETE");
  }
  joinRequests(kind: "device" | "print_agent"): Promise<JoinRequestRow[]> {
    return this.#request<JoinRequestRow[]>(`/management-api/join-requests?kind=${kind}`, "GET");
  }
  /** Three numbers, one of them this request's. The server does not say which, and the set is fixed
   * at join, so calling twice teaches nothing. */
  joinChallenge(id: string): Promise<{ choices: string[] }> {
    return this.#request<{ choices: string[] }>(
      `/management-api/join-requests/${id}/challenge`,
      "GET",
    );
  }
  /** A device's ask is named by `createdAt` too, because a returning device's next ask replaces it
   * under the same id; an ask already replaced is answered `join_request.not_found`, as one already
   * gone is. A print agent's ask needs no `createdAt`. */
  denyJoinRequest(id: string, ask?: { createdAt: string }): Promise<void> {
    return this.#request<void>(`/management-api/join-requests/${id}/deny`, "POST", ask);
  }
  /** A wrong `choice` is terminal: the server deletes the request before answering
   * `device.join_mismatch`, so the caller refreshes rather than offering a second attempt. A match
   * claims the request for this login and hold. `createdAt` names the ask, as on
   * {@link denyJoinRequest}. */
  checkDeviceJoinNumber(
    id: string,
    input: { choice: string; holdId: string; createdAt: string },
  ): Promise<void> {
    return this.#request<void>(`/management-api/device-join-requests/${id}/check`, "POST", input);
  }
  /** Refused `join_request.unclaimed` unless this login holds a live claim from
   * {@link checkDeviceJoinNumber}. */
  acceptDeviceJoinRequest(
    id: string,
    input: {
      name: string;
      profileId: string;
    },
  ): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
    return this.#request<{ deviceId: string; name: string; formFactor: FormFactor }>(
      `/management-api/device-join-requests/${id}/accept`,
      "POST",
      input,
      { timeLimitMs: DEVICE_ACCEPT_LIMIT_MS },
    );
  }
  /** A wrong `choice` is terminal: the server deletes the request before answering
   * `device.join_mismatch`. */
  acceptPrintAgentJoinRequest(id: string, input: { choice: string }): Promise<void> {
    return this.#request<void>(
      `/management-api/print-agent-join-requests/${id}/accept`,
      "POST",
      input,
    );
  }
  listDeviceProfiles(): Promise<DeviceProfile[]> {
    return this.#request<{ deviceProfiles: DeviceProfile[] }>(
      "/management-api/device-profiles",
      "GET",
    ).then((r) => r.deviceProfiles);
  }
  getDeviceProfile(id: string): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "GET");
  }
  /** Every live profile's kitchen screens. */
  listProfileKitchenScreens(): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]> {
    return this.#request<{ profiles: { profileId: string; screens: ProfileKitchenScreens }[] }>(
      "/management-api/device-profile-kitchen-screens",
      "GET",
    ).then((r) => r.profiles);
  }
  createDeviceProfile(
    name: string,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
    printerLists: ProfilePrinterLists,
    /** A part left out takes the server's default: no lists, every role, no starting screen. */
    extras?: ProfileSaveExtras,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>("/management-api/device-profiles", "POST", {
      name,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
      receiptPrinterIds: printerLists.receiptPrinterIds,
      paymentSlipPrinterIds: printerLists.paymentSlipPrinterIds,
      ...extras,
    });
  }
  copyDeviceProfile(
    sourceId: string,
    ...[name, capabilities, formFactor, inactivityTimeoutSeconds, printerLists, extras]: Parameters<
      DashboardApi["createDeviceProfile"]
    >
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(
      `/management-api/device-profiles/${encodeURIComponent(sourceId)}/copy`,
      "POST",
      {
        name,
        capabilities,
        formFactor,
        inactivityTimeoutSeconds,
        receiptPrinterIds: printerLists.receiptPrinterIds,
        paymentSlipPrinterIds: printerLists.paymentSlipPrinterIds,
        ...extras,
      },
    );
  }
  updateDeviceProfile(
    id: string,
    name: string,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
    printerLists: ProfilePrinterLists,
    /** A part left out stays as stored. */
    extras?: ProfileSaveExtras,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "PUT", {
      name,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
      receiptPrinterIds: printerLists.receiptPrinterIds,
      paymentSlipPrinterIds: printerLists.paymentSlipPrinterIds,
      ...extras,
    });
  }
  deleteDeviceProfile(id: string): Promise<void> {
    return this.#request<void>(`/management-api/device-profiles/${id}`, "DELETE");
  }
  getDeviceDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/devices/${id}/delete-impact`, "GET");
  }
  deleteDevice(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/devices/${id}`, "DELETE");
  }
  /** Everything about a device but its card reader, which `setDeviceReader` saves. */
  updateDevice(
    id: string,
    input: {
      name: string;
      profileId: string;
      /** Required for ordering profiles; kitchen profiles omit printer choices. Null is Use default. */
      receiptPrinterId?: string | null;
      paymentSlipPrinterId?: string | null;
      /** Absent leaves the stored drawer choice; null is Use default. */
      cashDrawerPrinterId?: string | null;
      /** A receipt or A4 printer; absent leaves the stored choice, null is Use default. */
      invoicePrinterId?: string | null;
      /** Absent leaves the device's stored made-here stations as they are. */
      madeHereStationIds?: string[];
      /** The profiles staff may switch to besides `profileId`; absent leaves them as they are. */
      approvedProfileIds?: string[];
    },
  ): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}`, "PATCH", input);
  }
}
