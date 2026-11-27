import type { CloudAddressOperation, CloudAddressReply } from "@waitron/country-packs";
import type { DeviceZoneSelection, DeviceZoneSelectionInput } from "@waitron/module";
import type { ReportDialogCloud } from "@waitron/ui/src/components/wt-report-dialog.js";
import type { FormFactor, CapabilityFlag, NavigationScreen } from "../layout.js";
import { MenuApi } from "./menu-api.js";
import type { HeldChart } from "./server-router.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

export interface TillCloudEmergency {
  address: string;
}
/**
 * `GET /api/till` — the public boot info the app reads before login. `cardProvider`/`tipsEnabled` decide whether the
 * integrated-card pay control renders at all and whether it prompts for a tip (`cardProvider: "none"`
 * for a till with no integrated reader).
 */
export interface TillInfo {
  cloudEmergency?: TillCloudEmergency;
  locale: string;
  clockingAvailable: boolean;
  onboardingIntent?: "demo" | "prepare" | "live";
  /** The receipt locale is independent of the UI {@link locale}. */
  invoiceLocale: string;
  /**
   * The receipt languages staff may choose for a sale or a copy, the venue's own first
   * (`readOfferedReceiptLanguages`).
   */
  receiptLanguages: string[];
  venueName: string;
  nif: string;
  /** The venue's ACTIVE kitchen courses, by `displayOrder`; `[]` for a venue with none. */
  courses: TillCourse[];
  cardProvider: "none" | "stripe_terminal" | "stripe_on_device" | "sumup_cloud" | "simulator";
  /**
   * The row id of the active reader the paying device resolves to (its chosen reader, else its
   * profile's default) when the till can drive it; absent otherwise. `cardProvider` only names a
   * provider TYPE and a venue can have several readers on one provider, so this is what finds that
   * reader's NAME in {@link activeReaders}.
   */
  defaultReaderId?: string;
  /** The venue's ACTIVE card readers, `[]` when none; feeds the payment-time reader picker. */
  activeReaders: TillActiveReader[];
  /** Whether the venue has saved a SumUp connection, including without a reader. */
  sumUpConnected?: boolean;
  tipsEnabled: boolean;
  formFactor: FormFactor;
  /** The CALLING device's capability set from its profile; `[]` for a no-profile or cookieless request. */
  capabilities: CapabilityFlag[];
  /**
   * The CALLING device's per-profile inactivity auto-logout, in seconds, or `null` for no idle logout
   * (also a no-profile or cookieless request).
   */
  inactivityTimeoutSeconds: number | null;
  /** The screen the CALLING device's profile opens at each sign-in; absent or `null` for none. */
  startingScreen?: NavigationScreen | null;
  nodeId: string;
  /** The venue's routable servers, primary first; `[]` when no membership document is held. */
  servers: TillServer[];
  /** The signed membership chart the server holds, or `null`; the router hands it to a server that
   * holds an older one. */
  membership?: HeldChart | null;
  /** The largest total a sale with no named customer may have, as a decimal string, or null when
   * the venue's fiscal regime sets none. The counter basket refuses an edit that would pass it. */
  simplifiedInvoiceLimit: string | null;
  /** Whether the server can issue a full invoice naming the customer (F1). */
  fullInvoices: boolean;
  /** Whether the venue's region charges a different VAT rate on food taken away. */
  takeawayVat: boolean;
  /** `/api/theme`'s hash for the theme in use. */
  themeHash: string;
  /** A hash of every field here but `servers` and `membership`; `/api/menu-state` names it too. */
  setupRevision: string;
}
/**
 * One venue-routable server as the boot payload carries it. `evicted` nodes are excluded server-side,
 * so `standing` is the three serving/sell states only.
 */
export interface TillServer {
  nodeId: string;
  url: string;
  standing: "serving-primary" | "serving-secondary" | "sell-only";
}
/** One ACTIVE kitchen course as the boot payload carries it. */
export interface TillCourse {
  id: string;
  name: string;
  displayOrder: number;
  fireNowZoneIds: string[];
}
/**
 * An active card reader from the boot payload. Bill payment requests name it in `readerId`.
 * The practice simulator has one virtual reader in Demo or Preparation.
 */
export interface TillActiveReader {
  id: string;
  name: string;
  provider: "stripe_terminal" | "sumup_cloud" | "simulator";
  printsOwnSlipAutomatically: boolean;
}
/** One `GET /api/staff` roster entry — no PIN, role or status. */
export interface StaffMember {
  personId: string;
  displayName: string;
}
/**
 * `POST /api/session` success. `permissions` is the server's list for the operator's role, so the
 * client never mirrors the role→permission map. Display only: the server checks each permission
 * itself, so a tampered list grants nothing.
 */
export interface SessionResult {
  personId: string;
  permissions: string[];
  /** The operator's stored UI locale, or `null` when they have never set one. */
  locale: string | null;
}
/**
 * `POST /api/device/join` success: the pending REQUEST's id and the two-digit number an admin picks out
 * of three in the dashboard to approve it. The device token leaves the server ONLY in the httpOnly
 * `Set-Cookie`. `joinId` IS the id the device will have once accepted — `acceptDeviceJoinRequest`
 * carries the request's id onto the `devices` row (`apps/server/src/join-requests.ts`).
 */
export interface DeviceJoinResult {
  joinId: string;
  verificationNumber: string;
}
/**
 * `GET /api/device/join/status` success. `not_approved` folds denied, lapsed and never-existed
 * together: the joiner's recovery is to knock again in every one of those cases.
 */
export interface DeviceJoinStatus {
  status: "pending" | "approved" | "not_approved";
}
/**
 * `GET /api/device/me` success — the enrolled device's own NON-SECRET identity, read on boot to choose
 * which shell the till boots into (via {@link kindOfFormFactor}). `formFactor` is a plain `string`, not
 * a union: the client branches only on the values it knows, so a new server form factor never breaks
 * an older client.
 */
export interface DeviceIdentity {
  deviceId: string;
  formFactor: string;
  name: string;
  /** A kitchen display runs the first available one. */
  kitchenScreens: ResolvedKitchenScreen[];
  /** The device's active profile. A server too old to send it offers no switch. */
  profileId?: string;
  /** The profiles a signed-in person may switch the device to, the active one first. */
  approvedProfiles?: ProfileChoice[];
}

export type KitchenScreenKind = "station" | "pass" | "pass_monitor";
/** One station or zone of a device's kitchen screen: shown, or no longer available. */
export interface ScreenSlot {
  id: string;
  name: string;
  available: boolean;
}

export interface ResolvedKitchenScreen {
  kind: KitchenScreenKind;
  available: boolean;
  stations: ScreenSlot[];
  /** null: no zone filter. */
  zones: ScreenSlot[] | null;
  showNonPassStations: boolean;
}

export interface ProfileChoice {
  id: string;
  name: string;
}
/** `POST /api/device/active-profile` success: the device's profile as stored. */
export interface DeviceProfileSwitched {
  activeProfileId: string;
}
/** The five things a device prints, opens and pays on, in the order the server lists them. */
export type EquipmentRole =
  "receipt" | "payment_slip" | "cash_drawer" | "invoice" | "card_terminal";
/** Another device holding a portable item, and who is signed in on it, if anyone. */
export interface EquipmentHolder {
  deviceId: string;
  deviceName: string;
  personName: string | null;
}

export interface EquipmentItem {
  id: string;
  name: string;
  /** A printer's kind, `a4` for an A4 printer; a reader has none. */
  kind?: "receipt" | "a4";
  portable: boolean;
  /** Switched on; a reader also still paired. */
  available: boolean;
  /** A reader another device has a payment in progress on. */
  busy: boolean;
  /** Another device holding it; never this one, and never for a cash drawer or an invoice printer. */
  heldBy: EquipmentHolder | null;
  /** A reader's provider as the venue stores it (`sumup`, `stripe`); a printer has none. */
  provider?: string;
  printsOwnSlipAutomatically?: boolean;
}
/** One role of the device: what it chose, its profile's default, and what it resolves to now. */
export interface RoleEquipment {
  role: EquipmentRole;
  /** `default`: the device follows its profile's default. */
  selection: "default" | "item";
  chosenId: string | null;
  /** What the role prints, opens or pays on now; `null` for none. */
  resolved: {
    id: string;
    name: string;
    available: boolean;
    provider?: string;
    printsOwnSlipAutomatically?: boolean;
  } | null;
  chosen: EquipmentItem | null;
  default: EquipmentItem | null;
  /** What the device may newly choose for the role, in list order. */
  choices: EquipmentItem[];
}
/** `PUT /api/device/equipment` success, and the equipment half of the GET's: always the five roles. */
export interface DeviceEquipment {
  roles: RoleEquipment[];
  /** The device has a drawer it may open: its drawer printer is switched on, has a drawer, and
   * its profile allows opening it. */
  opensDrawer?: boolean;
  drawerPrinterId?: string | null;
}
/** One notice for staff, as `GET /api/device/equipment` sends it: worded by the till from `code`. */
export interface StaffNotice {
  owner: string;
  key: string;
  code: string;
  severity: "error" | "warning" | "notice";
  params: Record<string, unknown>;
}
/** `GET /api/device/equipment` success. The two notice keys are optional: a read without them
 * has no notices. */
export interface DeviceEquipmentRead extends DeviceEquipment {
  notices?: StaffNotice[];
  /** Owners whose notice check failed on this read. */
  noticesUnavailable?: string[];
}
/** `PUT /api/device/equipment`'s body. A `scan`, or a `list` choice sent with `takeOver`, takes an
 * item another device holds; a `list` choice without it is refused `device.equipment_held`. */
export type EquipmentChange =
  | {
      role: EquipmentRole;
      selection: "default" | { id: string };
      via: "scan" | "list";
      takeOver?: boolean;
    }
  | {
      role?: undefined;
      kind: "printer" | "reader";
      selection: { id: string };
      via: "scan";
    };

export interface DevDevice {
  id: string;
  kind: string;
  label: string;
  active: boolean;
}

export interface DevDeviceList {
  devices: DevDevice[];
}
/** A "Check the time" that went through: `stepMs` 0 confirmed the box's time, any other set it. */
export interface BoxClockConfirmed {
  confirmationId: string | null;
  stepMs: number;
  confirmedAt: string;
}

export class DeviceSessionApi extends MenuApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  previewProblemReport(signal: AbortSignal): ReturnType<ReportDialogCloud["previewProblemReport"]> {
    return this.#request("/api/problem-reports/preview", "GET", undefined, signal);
  }
  sendProblemReport(
    id: string,
    signal: AbortSignal,
    description?: string,
  ): ReturnType<ReportDialogCloud["sendProblemReport"]> {
    return this.#request(
      `/api/problem-reports/${encodeURIComponent(id)}/send`,
      "POST",
      description === undefined ? undefined : { description },
      signal,
    );
  }
  getTill(options: ReadOptions = {}): Promise<TillInfo> {
    return this.#request<TillInfo>("/api/till", "GET", undefined, options.signal);
  }
  /** The people who may sign in on this device; with `everyone`, every active colleague. */
  listStaff(options: { everyone?: boolean } = {}): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>(
      options.everyone === true ? "/api/staff?everyone=true" : "/api/staff",
      "GET",
    );
  }
  login(personId: string, pin: string): Promise<SessionResult> {
    return this.#request<SessionResult>("/api/session", "POST", { personId, pin }, undefined, {
      namesPerson: false,
    });
  }
  async logout(): Promise<void> {
    await this.#request<{ ok: boolean }>("/api/session", "DELETE");
  }
  addressLookup(operation: CloudAddressOperation, signal: AbortSignal): Promise<CloudAddressReply> {
    return this.#request("/api/address-lookup", "POST", operation, signal);
  }
  /** A challenge for "Check the time": the box's time, valid for a few seconds, and `keepOffered`
   * while its start waits. `override` says an administrator signing in here asks; its PIN is
   * checked by the confirm. */
  boxClockChallenge(override?: {
    personId: string;
    pin: string;
  }): Promise<{ challengeId: string; boxAt: string; keepOffered?: true }> {
    return this.#request(
      "/api/box-clock/challenge",
      "POST",
      override === undefined ? {} : { override },
    );
  }
  /** Confirms the box's time, or sets it to `deviceAt`, this till's own time in milliseconds;
   * `keep`, offered only while the box's start waits, confirms its time whatever `deviceAt` says. */
  boxClockConfirm(body: {
    challengeId: string;
    deviceAt: number;
    keep?: true;
    override?: { personId: string; pin: string };
  }): Promise<BoxClockConfirmed> {
    return this.#request("/api/box-clock/confirm", "POST", body);
  }
  /**
   * Persist the signed-in operator's OWN UI language → `PUT /api/session/locale`. The session names the
   * person, so there is no id to pass. An unsupported `code` rejects with `locale.unsupported`.
   */
  async putLocale(code: string): Promise<void> {
    await this.#request<void>("/api/session/locale", "PUT", { locale: code });
  }
  /** `PUT /api/device/battery`, as the device the cookie names; `level` is a whole percentage. */
  async reportBattery(
    report: { level: number; charging: boolean },
    options: ReadOptions = {},
  ): Promise<void> {
    await this.#request<void>("/api/device/battery", "PUT", report, options.signal);
  }
  // --- Device mode: these verbs need NO operator session; the httpOnly device cookie rides
  // `credentials: "include"` like the session cookie. ---

  /**
   * Ask to join this venue → `POST /api/device/join`. Unauthenticated. Refused `device.pairing_closed`
   * (403) unless an admin has pairing mode open, or if it shut during the knock; otherwise sets an
   * httpOnly cookie naming a pending REQUEST, inert until an admin approves it. A flood draws
   * `device.join_rate_limited`; a venue at its pending cap `device.join_full`; a knock another knock
   * or an approval of this device overtook `device.join_stale`, with no new cookie.
   */
  join(name: string): Promise<DeviceJoinResult> {
    return this.#request<DeviceJoinResult>("/api/device/join", "POST", { name });
  }
  /**
   * Am I in yet? → `GET /api/device/join/status`. No new cookie follows an approval: the SAME cookie
   * that named the request now names the device. A missing or malformed cookie rejects
   * `device.unauthorized` (401).
   */
  joinStatus(): Promise<DeviceJoinStatus> {
    return this.#request<DeviceJoinStatus>("/api/device/join/status", "GET");
  }
  /**
   * This enrolled device's OWN identity → `GET /api/device/me`. A missing, rejected or revoked cookie
   * rejects `device.unauthorized` (401) — the signal that this browser is not an enrolled device.
   */
  getDeviceIdentity(options: ReadOptions = {}): Promise<DeviceIdentity> {
    return this.#request<DeviceIdentity>("/api/device/me", "GET", undefined, options.signal);
  }
  /**
   * Switch the session's device to another approved profile → `POST /api/device/active-profile`. The
   * server refuses a profile the device is not approved for (`device_profile.not_approved`), one the
   * signed-in person may not use (`device_profile.not_admitted`), and a switch during a card payment
   * the device started (`device.payment_in_progress`).
   */
  switchDeviceProfile(profileId: string): Promise<DeviceProfileSwitched> {
    return this.#request<DeviceProfileSwitched>("/api/device/active-profile", "POST", {
      profileId,
    });
  }
  getDeviceZones(options: ReadOptions = {}): Promise<DeviceZoneSelection> {
    return this.#request<DeviceZoneSelection>(
      "/api/device/zones",
      "GET",
      undefined,
      options.signal,
    );
  }
  setDeviceZones(
    input: DeviceZoneSelectionInput,
    options: ReadOptions = {},
  ): Promise<DeviceZoneSelection> {
    return this.#request<DeviceZoneSelection>("/api/device/zones", "PUT", input, options.signal);
  }
  /** The device's equipment → `GET /api/device/equipment`, as the device the cookie names. */
  getDeviceEquipment(options: ReadOptions = {}): Promise<DeviceEquipmentRead> {
    return this.#request<DeviceEquipmentRead>(
      "/api/device/equipment",
      "GET",
      undefined,
      options.signal,
      { headers: { "x-waitron-device-clock": String(Date.now()) } },
    );
  }
  /**
   * Choose one of the session's device's equipment → `PUT /api/device/equipment`. Refused
   * `device.binding_invalid` (naming the role's `field`) for an item the device may not newly choose,
   * `device.equipment_held` for an unconfirmed list choice of an item another device holds, and
   * `reader.payment_in_progress` for a reader another device is taking a payment on.
   */
  setDeviceEquipment(change: EquipmentChange, options: ReadOptions = {}): Promise<DeviceEquipment> {
    return this.#request<DeviceEquipment>("/api/device/equipment", "PUT", change, options.signal);
  }
  /** Available in development and Demo venues; other venues answer 404. */
  getDevDevices(): Promise<DevDeviceList> {
    return this.#request<DevDeviceList>("/api/dev/devices", "GET");
  }
}
