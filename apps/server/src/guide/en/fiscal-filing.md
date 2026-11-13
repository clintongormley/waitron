# Fiscal filing

**Fiscal filing** shows how this box's invoice records are being sent to AEAT, the tax agency, and
which records need a decision. It only reads: nothing on this page sends, retries or changes a
record.

## Open the page {#open}

Open **Reporting → Fiscal filing**. Managers and administrators see it.

The page reads the box when you open it. It does not update by itself: choose **Refresh** to read
again. **Read at** says when the figures were read.

## An identity conflict {#conflict}

When this box has stopped issuing invoices because of an identity conflict, a red box at the top
says so and lists each invoice involved with what AEAT holds for it. AEAT's own words, its
fingerprint and the installation name are under **Technical details**. Choose **Open conflict
recovery** and follow [Recover an invoice identity conflict](box-status.md#invoice-conflict). You
need the server key.

## Sending progress {#progress}

**Sending progress** counts the box's records by where they are: waiting, sending, accepted,
accepted with errors, refused, held or set aside. **Oldest waiting** and **Last accepted** show
whether records are still going out. To try waiting records again without waiting for the box's
pause, use **Retry now** on [Box status](box-status.md#retry-now).

If the page says nothing can be sent until the tax agency's certificate is installed, install it in
**Venue settings**.

## Filing cases {#cases}

Each row is a record that still needs a decision; **Reason** says why. **Held behind it** counts
the records waiting behind that one. Open the row's menu and choose **View** to see what the
record is, where it stands, AEAT's reply in its own words (in Spanish), and **What happens now**.
The codes and fingerprints your tax adviser may ask for are under **Technical details**.

When AEAT refused a record for its operation description, the case shows AEAT's message beside the
description: correct it there and choose **Send the correction**. Only an administrator can send
it; anyone else can sign in as one from the case.

The table lists the newest 200 cases. When there are more, it says how many; export them to see
every one.

## Export the cases {#export}

**Export these cases for your tax adviser** reads the box again and downloads one file with every
open case, not only the 200 on screen, together with the rest of the page.

## Possibly missing history {#missing-history}

**Possibly missing history** shows where AEAT may hold invoices that this box does not. Neither list
says that an invoice is missing.

- **Invoices AEAT holds that this box did not issue**: each invoice that a check with AEAT found
  under a series this box no longer uses, and that this box did not issue.
- **Identity changes without a handover**: each time this box's fiscal identity changed other than
  by a handover, for example after a restore, with the last invoice the box holds under the earlier
  identity, if it holds any.

When either list has a line, choose **Export these cases for your tax adviser**: the file carries
both lists.
