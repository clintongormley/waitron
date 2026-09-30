import { isNetworkFailure, type TillApi } from "../api/client.js";

/** How many times a bill request that got no answer is sent again, under the same submission id. */
export const BILL_REQUEST_RETRIES = 2;

/** The wait before a bill request that got no answer is sent again. */
export const BILL_REQUEST_RETRY_PAUSE_MS = 500;

/**
 * One person's press: a submission id of its own, sent at the party revision the screen last read.
 * Only a request that got no answer is sent again, unchanged, so the server answers a repeat as it
 * answered the first (D8); a refusal, `party.out_of_date` included, is thrown to the caller.
 */
export async function sendBillRequest(
  api: TillApi,
  partyId: string,
  requested: boolean,
  expectedPartyRevision: number,
): Promise<{ revision: number; billRequestedAt: string | null }> {
  const command = { submissionId: crypto.randomUUID(), expectedPartyRevision, requested };
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.requestBill(partyId, command);
    } catch (error) {
      if (!isNetworkFailure(error) || attempt === BILL_REQUEST_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, BILL_REQUEST_RETRY_PAUSE_MS));
    }
  }
}
