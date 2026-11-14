import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { FilingOverviewAnswer } from "../filing-overview-types.js";

const PATH = "/management-api/fiscal-filing";

export interface DescriptionCorrection {
  kind: "record-correction";
  registroId: string;
  /** One per dialog opening, so sending again is answered from the decision already saved. */
  actionKey: string;
  reason: string;
  facts: { description: string };
}

/** Replaces a simplified invoice AEAT refused for a future date; the server takes every amount
 * from its own records. */
export interface ReplacementInvoice {
  kind: "replacement-invoice";
  registroId: string;
  actionKey: string;
  reason: string;
  /** The day the sale really happened, `YYYY-MM-DD`. */
  operationDate: string;
}

export class FiscalFilingClient {
  readonly #request: DashboardRequest;

  constructor(request: DashboardRequest) {
    this.#request = request;
  }

  /** `all` reads every open case, for the export the person asked for; the screen's reads are
   * passive, so an open tab does not keep a session alive. */
  read({ all }: { all: boolean }): Promise<FilingOverviewAnswer> {
    return all
      ? this.#request<FilingOverviewAnswer>(`${PATH}?cases=all`, "GET")
      : this.#request<FilingOverviewAnswer>(PATH, "GET", undefined, { passive: true });
  }

  putRight(body: DescriptionCorrection | ReplacementInvoice): Promise<unknown> {
    return this.#request("/management-api/fiscal-records/remedy", "POST", body);
  }
}
