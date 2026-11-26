import { AttendanceApi } from "./attendance-api.js";
import type { StaffMember } from "./device-session-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

type DrawerCount = {
  id: string;
  personId: string;
  recordedAt: string;
  counted: string;
  expected: string;
  difference: string;
  cashMovedWhileCounting: boolean;
  throughSequence: number;
};

export type SavedDrawerCount = {
  printerId: string;
  state: "counted";
  openingCash: string;
  first: DrawerCount;
  recount: DrawerCount | null;
  available: string;
  confirmSequence: number;
};

export type DrawerEntryRequest = {
  printerId: string;
  submissionId: string;
  kind: "cash_in" | "cash_out";
  amount: string;
  reason: string;
};

export type DrawerCloseRead =
  | { printerId: string; state: "new"; openingCash: string; startSequence: number }
  | SavedDrawerCount;

export type FinishedDrawerClose = {
  printerId: string;
  state: "finished";
  id: string;
  firstCountId: string;
  personId: string;
  recordedAt: string;
  bankWithdrawal: string;
  amountLeft: string;
  difference: string;
  throughSequence: number;
  slip: "queued" | "unavailable" | "already_closed";
};

export class DrawerApi extends AttendanceApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  /**
   * Open the cash drawer with no sale → `POST /api/drawer/open`. Authorized and audited server-side; the
   * device's drawer is resolved there. A cash-entry form can supply its expected printer id.
   *
   * An operator whose role lacks `cash.drawer` is refused
   * `authorization.not_permitted` (403); the caller then fetches {@link listDrawerAuthorizers} and
   * retries with `override: { personId, pin }` for the authorizing supervisor. The override travels
   * ONLY in this request's body, never a URL, and only when supplied. A wrong PIN rejects `pin.invalid`
   * (401); a device with no drawer `drawer.no_printer` (400).
   */
  async openDrawer(
    override?: { personId: string; pin: string },
    expectedPrinterId?: string,
  ): Promise<void> {
    await this.#request<void>("/api/drawer/open", "POST", { override, expectedPrinterId });
  }
  saveDrawerEntry(body: DrawerEntryRequest): Promise<{ id: string; printerId: string }> {
    return this.#request("/api/drawer/entries", "POST", body);
  }
  readDrawerClose(): Promise<DrawerCloseRead> {
    return this.#request("/api/drawer/close", "GET");
  }
  saveDrawerCount(body: {
    printerId: string;
    counted: string;
    startSequence: number;
  }): Promise<SavedDrawerCount> {
    return this.#request("/api/drawer/close/count", "POST", body);
  }
  recountDrawer(
    firstCountId: string,
    body: { counted: string; startSequence: number },
  ): Promise<SavedDrawerCount> {
    return this.#request(`/api/drawer/close/${firstCountId}/recount`, "POST", body);
  }
  finishDrawerClose(
    firstCountId: string,
    body: { amountLeft: string; confirmSequence: number },
  ): Promise<FinishedDrawerClose> {
    return this.#request(`/api/drawer/close/${firstCountId}/finish`, "POST", body);
  }
  /**
   * The eligible authorizers for a manual drawer open → `GET /api/drawer/authorizers`: the active persons
   * whose role holds `cash.drawer`, with no secrets.
   */
  listDrawerAuthorizers(options: ReadOptions = {}): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>(
      "/api/drawer/authorizers",
      "GET",
      undefined,
      options.signal,
    );
  }
}
