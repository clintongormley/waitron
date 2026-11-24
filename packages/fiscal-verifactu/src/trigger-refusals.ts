// The filing case and its resolution are evidence of how the filing was handled.
export const SUBMISSION_CHANGE_REFUSAL =
  "verifactu_submissions: a filing case and its resolution are set once";

// Deleting the outbox row would drop the filing.
export const SUBMISSION_DELETE_REFUSAL = "verifactu_submissions: a submission row is never deleted";

// A missing gate row lets the drainer send before AEAT's wait ends.
export const SENDING_STATE_DELETE_REFUSAL =
  "verifactu_sending_state: the sending gate is never deleted";

// The allocation is the evidence that the identity was granted.
export const IDENTITY_CHANGE_REFUSAL = "verifactu_identities: only revocado_en may be set, once";

// Even an unused installation name must stay taken.
export const IDENTITY_DELETE_REFUSAL = "verifactu_identities: an identity is never deleted";
