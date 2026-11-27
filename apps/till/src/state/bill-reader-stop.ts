import type { TillApi } from "../api/client.js";
import type { BillReaderStopOutcome } from "../api/payments-api.js";
import type { ReaderStopControl } from "../widgets/card-waiting.js";
import { refusalOf } from "./bill-payment.js";
import { TABLE_REQUEST_LIMIT_MS } from "./draft-sync.js";

export interface BillReaderStop extends Omit<ReaderStopControl, "request"> {
  submissionId: string;
  signal?: AbortSignal;
  answer?: Promise<BillReaderStopOutcome>;
}

export async function requestBillReaderStop(
  api: TillApi,
  billId: string,
  stop: BillReaderStop,
  update: () => void,
): Promise<void> {
  if (stop.status === "sending" || stop.status === "requested" || stop.status === "unknown") return;
  stop.status = "sending";
  stop.refusal = undefined;
  update();
  stop.answer = api
    .cancelBillReaderPayment(billId, stop.submissionId, {
      signal: stop.signal ?? AbortSignal.timeout(TABLE_REQUEST_LIMIT_MS),
    })
    .then(
      ({ outcome }) => outcome,
      (error: unknown): BillReaderStopOutcome => {
        const status = (error as { status?: unknown } | null)?.status;
        if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) {
          stop.refusal = refusalOf(error, false);
          return "refused";
        }
        return "unknown";
      },
    );
  stop.status = await stop.answer;
  update();
}
