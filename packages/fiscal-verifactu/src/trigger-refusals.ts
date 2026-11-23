// The filing case and its resolution are evidence of how the filing was handled.
export const SUBMISSION_CHANGE_REFUSAL =
  "verifactu_submissions: a filing case and its resolution are set once";

// Deleting the outbox row would drop the filing.
export const SUBMISSION_DELETE_REFUSAL = "verifactu_submissions: a submission row is never deleted";

// A missing gate row lets the drainer send before AEAT's wait ends.
export const SENDING_STATE_DELETE_REFUSAL =
  "verifactu_sending_state: the sending gate is never deleted";
