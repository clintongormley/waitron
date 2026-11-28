import type { TicketState } from "./kitchen-api.js";
import { type OrderStateCounts, OrdersApi } from "./orders-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

export interface DepartmentTransfer {
  currentDepartmentId?: string;
  /** Present only where the viewer may see the tab. */
  counts?: OrderStateCounts;
  id: string;
  tabId: string;
  sourceDepartmentId: string;
  destinationDepartmentId: string;
  senderId: string;
  resolvedBy: string | null;
  destinationZoneId: string | null;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  revision: number;
  summary?: {
    orderNumber: number;
    tabLabel: string | null;
    tableLabel?: string;
    counter?: true;
    sourceDepartmentName: string;
    destinationDepartmentName: string;
  };
}

export interface DepartmentTransferDetail {
  request: DepartmentTransfer;
  tab: {
    id: string;
    revision: number;
    status: "open" | "placed";
    label: string | null;
    orderNumber: number;
    deliveryTableId: string | null;
  };
  lines: {
    id: string;
    name: string;
    variantName: string | null;
    quantity: string;
    unitPriceGross: string;
    note: string | null;
    parentLineId: string | null;
  }[];
  outstandingWork: {
    id: string;
    lineId: string;
    stationId: string;
    stationName: string | null;
    state: TicketState;
    note: string | null;
    requestedAt: string | null;
    firedAt: string | null;
    courseId: string | null;
  }[];
}

export class DepartmentTransfersApi extends OrdersApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  listDepartmentTransferDestinations(options: ReadOptions = {}): Promise<{
    destinations: { id: string; name: string }[];
  }> {
    return this.#request(
      "/api/department-transfers/destinations",
      "GET",
      undefined,
      options.signal,
    );
  }
  listIncomingDepartmentTransfers(options: ReadOptions = {}): Promise<{
    receiving: boolean;
    count: number;
    requests: DepartmentTransfer[];
  }> {
    return this.#request("/api/department-transfers/incoming", "GET", undefined, options.signal);
  }
  listDepartmentSentTransfers(
    options: ReadOptions = {},
  ): Promise<{ requests: DepartmentTransfer[] }> {
    return this.#request("/api/department-transfers/sent", "GET", undefined, options.signal);
  }
  listSentDepartmentTransfers(
    tabId: string,
    options: ReadOptions = {},
  ): Promise<{
    requests: DepartmentTransfer[];
  }> {
    return this.#request(
      `/api/working-orders/${encodeURIComponent(tabId)}/department-transfers`,
      "GET",
      undefined,
      options.signal,
    );
  }
  getDepartmentTransfer(
    requestId: string,
    options: ReadOptions = {},
  ): Promise<DepartmentTransferDetail> {
    return this.#request(
      `/api/department-transfers/${encodeURIComponent(requestId)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  requestDepartmentTransfer(
    tabId: string,
    destinationDepartmentId: string,
  ): Promise<DepartmentTransfer> {
    return this.#request(
      `/api/working-orders/${encodeURIComponent(tabId)}/department-transfers`,
      "POST",
      { destinationDepartmentId },
    );
  }
  withdrawDepartmentTransfer(requestId: string): Promise<DepartmentTransfer> {
    return this.#request(
      `/api/department-transfers/${encodeURIComponent(requestId)}/withdraw`,
      "POST",
    );
  }
  acceptDepartmentTransfer(
    requestId: string,
    choice: { revision: number; zoneId: string; tableId: string | null; closedZoneId?: string },
  ): Promise<DepartmentTransfer> {
    return this.#request(
      `/api/department-transfers/${encodeURIComponent(requestId)}/accept`,
      "POST",
      choice,
    );
  }
  declineDepartmentTransfer(requestId: string, reason: string): Promise<DepartmentTransfer> {
    return this.#request(
      `/api/department-transfers/${encodeURIComponent(requestId)}/decline`,
      "POST",
      { reason },
    );
  }
}
