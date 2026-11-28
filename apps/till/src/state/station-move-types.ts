import type { TillApi } from "../api/client.js";
import type { BillEditExpected } from "../api/order-types.js";

/** One dish of a table's or the counter basket's order, moving to another station. */
export interface DishMove {
  kind?: undefined;
  workingOrderId: string;
  lineId: string;
  /** Every portion a grouped row moves, by line number; absent, the move is `lineId` alone. */
  lineIds?: string[];
  name: string;
  stationId: string | null;
  refusal: string | null;
  stationName?: string;
  busy: boolean;
  counter?: boolean;
  basketRevision?: number;
  basketGeneration?: number;
  counterContext?: { api: TillApi; session: number; visit: number };
  bill?: {
    expectedEdit: BillEditExpected;
    api: TillApi;
    session: number;
    visit: number;
    partyId: string;
    viewBillId: string | undefined;
  };
}

/** Every dish of a paid order in the counter's waiting list that can still move. `stationId` is
 * the station they all share, or null. */
export interface WaitingOrderMove {
  kind: "waiting";
  workingOrderId: string;
  name: string;
  stationId: string | null;
  refusal: string | null;
  stationName?: string;
  busy: boolean;
  session: number;
  api: TillApi;
}
