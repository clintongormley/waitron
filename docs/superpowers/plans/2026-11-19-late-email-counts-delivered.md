# Plan: an invoice email confirmed late counts as delivered (LATE-EMAIL-COUNTS-DELIVERED)

Status: built, 2026-11-19, lane L. FISCAL: the owner lands it.

## The ask, and who decided it

Owner, 2026-11-18, in the watcher's window (picker "Land, then count it", relayed in lane L's
queue): after #3773 lands, an invoice email whose success is confirmed late counts as delivered, so
any later delivery is a «DUPLICADO» copy, never a second original. This follows the 7 October rule
already in the delivery plan (`2026-10-03-invoice-pdf-email-and-office-printing.md`, line 51: "SMTP
acceptance is completion for email; a later complaint of non-receipt does not undo acceptance").
The same plan's line 130 says the opposite for one case; this change corrects it.

What staff get: when the mail server accepts an invoice email after the till had given up waiting,
and staff had already asked for another original, Waitron treats the first email as the original.
The till and dashboard show the invoice as delivered, the uncertain-delivery alert goes, and every
later print or email of that invoice is marked «DUPLICADO».

## What happens today (read in `apps/server/src/invoice-delivery.ts`, main `b49a25b0db`)

- An email attempt whose mail-sending claim runs past its lease is marked `unknown`
  (`abandonInvoiceEmail`, called from the mail sender, `mail-sender.ts`). A late answer can then
  arrive from the first sending pass. At a restart, emails are also abandoned
  (`abandonMailClaims`), but no late answer can follow; `expireInvoiceDeliveryClaims` skips email.
- When the mail server's answer arrives after that, `settleInvoiceEmail` calls
  `recordDeliveryReport`. If no newer attempt exists for the sale, a success already turns the
  attempt into `sent`, and the invoice counts as delivered. Nothing changes there.
- If a newer attempt exists (staff pressed Retry original, or chose another medium), the report is
  "historical": it stores `reportedOutcome: "sent"` and nothing else. The attempt stays `unknown`,
  `originalCompleted` stays false (`invoice-delivery-status.ts`), the next delivery is still an
  original, and #3773's check-first alert and till wording show.

So the change is only the historical case, and only for email.

## The change

1. In `recordDeliveryReport`, when the delivery is an **email**, the outcome is **sent**, and the
   report is historical, record the attempt as `sent` with `completedAt`, exactly as the
   non-historical success does. Its newer attempt is left as it is, except step 2.
2. In the same transaction, every newer attempt of the same sale that is still **`queued`** and
   designated **original**, by email or A4, becomes **`duplicate`**. Both read their designation
   only when they go out (email at claim, `invoice-mail.ts` compose; A4 at each fetch,
   `page-print-api.ts`), so the copy that goes out carries «DUPLICADO». An attempt already
   `sending` or finished keeps its designation: its document may already be out.
3. **Automatic email retries** (`retryInvoiceEmail`, after the mail server refuses an attempt)
   take `duplicate` once the sale has a completed original, instead of copying the failed
   attempt's designation (`invoice-delivery.ts:565`). Without this, a retry already being sent
   when the late success arrives, then refused, would be retried automatically as a second
   original (the plan read reproduced that end state).
3a. A newer **receipt** original already queued as a print job keeps «original» bytes
   (`receiptCopy: false`, fixed at enqueue). If the printer is offline it can print after the
   email was counted: a second original. Not built: the watcher chose to leave it (2026-11-19,
   option B, not the owner's; `questions.md` "WATCHER 2026-11-19 06:33"), and the PR's first
   lines say so, so the owner can ask for the job to be ended and a copy queued instead.
4. A4 and receipt late reports keep today's rule (history only once superseded). The owner's
   answer is about email, and line 51 is about SMTP acceptance.
5. Nothing filed with AEAT changes: no invoice record, chain, number or series is touched; only
   `invoice_deliveries` rows change.

Once a queued email or A4 attempt becomes a duplicate, the till no longer offers "receipt instead"
for it, and a request already on screen is refused as `invoice_delivery.active`. That follows the
new rule; the PR says so.

#3773's check-first wording and alert stay: they still apply to a late A4 or receipt success.

## Docs

- Delivery plan line 130: add after "complete its delivery." — "Exception (owner, 2026-11-18):
  a late **email** success always completes its attempt, and a newer queued email or A4 original
  becomes a duplicate (plan `2026-11-19-late-email-counts-delivered.md`)." The same bullet's
  serialisation sentence then reads: completion first means a later action is duplicate; for email,
  retry first and completion second turns the retry, while still queued, into a duplicate.
- Guide: grep the English and Spanish guides for the late-delivery wording #3773 added; change a
  sentence only if it now says something untrue for email.

## Tests (test first)

- Email: an attempt marked `unknown`, then Retry original by email (newer attempt queued), then
  the late success: the first attempt is `sent`, `originalCompleted` is true, the queued retry is
  `duplicate`, and the email it sends is marked «DUPLICADO» (through the real compose).
- Email late success after the newer attempt has already been claimed or sent: first attempt
  `sent`, newer attempt keeps `original`.
- Newer attempt by A4 still queued: becomes `duplicate`, and the page fetched says «DUPLICADO».
- The read's sequence: first email abandoned, Retry original by email already claimed, late
  success, then the mail server refuses the retry: the automatic retry is `duplicate`.
- Late **failure** on a superseded email: unchanged (history only).
- A4 late success on a superseded attempt: unchanged (the existing status test at
  `invoice-delivery-status.test.ts` "lists every attempt newest first, with its staff member and a
  late success" stays as it is).
- The uncertain-delivery alert: gone for an email late success; still raised for an A4 one.
- Deletion control for each new rule (remove the email branch, see the tests fail; remove the
  queued-retry flip, see its test fail).

Existing checks that pin the historical email case change under the owner's 2026-10-05 rule
(the spec changes what they check). Expected in `invoice-delivery.test.ts`,
`invoice-delivery-status.test.ts`, `alert-sources.invoice-delivery.test.ts` and
`invoice-customer-data.files.test.ts`; the PR lists every changed line in "Changed test checks".
Golden huella and `inmutabilidad` pass unedited.

## Size and review

Expect under 60 production lines and about 150 test lines. Full review wave with two Codex run-it
reviews (lane L). The owner lands it.
