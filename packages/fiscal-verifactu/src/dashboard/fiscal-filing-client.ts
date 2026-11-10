import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { FilingOverviewAnswer } from "../filing-overview-types.js";

const PATH = "/management-api/fiscal-filing";

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
}
