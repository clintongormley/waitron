# A853 — the box makes a company seal's key itself — design

Status: for the owner's approval (written 2026-11-27 by lane L). Backlog: `docs/backlog/fiscal.md`, A853.

## What changes for the owner

Today a certificate reaches the box only as a `.pfx`/`.p12` file holding the certificate and its
private key (the secret half that proves the box is the company), through setup's first step or
**Replace certificate** on the AEAT certificate card (Venue settings). A company seal (_sello de
entidad_) cannot arrive that way without moving its key: FNMT says the key and the request must be
made «en una máquina del suscriptor», and it sends back only the certificate
(`docs/compliance/getting-to-production.md:183-185`, `:201-203`).

After this item, the card has a second button, **Request a company seal**. The box makes the key and
a request, the owner pastes the request into FNMT's form, and when FNMT has issued the seal the owner
installs the file FNMT gives them on the same card. The key is made on the box and kept locked in its
database, so it is also in the box's backups and on a spare box (`packages/db/src/classification.ts:259-260`,
`packages/handover/src/manifest.ts:152-156`); nobody can download it. The certificate already
installed keeps filing until the seal replaces it.

## The flow, step by step

1. **Request a company seal.** The box makes a key and a request for the business's legal name and
   tax ID, read from the venue's record. The key is of the common kind (RSA) because FNMT's form warns
   against its other kind without prior authorisation (`getting-to-production.md:177-179`). Not
   recorded in the repo, so the plan quotes FNMT's own page on each before anything is built: the
   key length FNMT wants, and the file format FNMT's download gives.
2. **The request is shown** with a **Copy request** button, already without its first and last lines,
   as FNMT's form asks (`:184-185`), and FNMT's steps in order: open the form (link), choose the
   seal, paste, sign the contract with your representative certificate, send the registry
   certificate, keep the request code FNMT emails you (needed for the download, `:195-196`), pay,
   download.
3. **While FNMT works** (days or weeks), the card shows a block above the current certificate's rows:
   "Seal request waiting for FNMT. Made 27 Nov 2026." with **Show request**, **Install the issued
   seal** and **Cancel request**. The block takes the place of the **Request a company seal**
   button: one request at a time. Filing goes on with the installed certificate, whatever its type;
   if none is installed, records wait as they do today.
4. **Install the issued seal** takes the file FNMT lets the owner download; it has no passphrase. The
   box checks the certificate was made from this box's request (it matches the waiting key), then
   runs every check **Replace certificate** runs today: dates, the tax ID when the seal carries one,
   not the one already installed, and a live question to AEAT that files nothing
   (`packages/fiscal-verifactu/src/certificate-install.ts:131-157`, `:208-222`). Only then does it
   replace the installed certificate and delete the waiting request.
5. **How it is stored.** The box keeps the seal and its key together, locked, in the same form it
   keeps today's certificate (a `.p12` file in the box's store of secrets,
   `packages/credentials/src/purposes.ts:22`), under a passphrase the box makes and never shows.
   Filing reads that entry as it does today (`packages/fiscal-verifactu/src/aeat-transport.ts:62-64`).
   Whether FNMT's own issuing certificate must be kept beside the seal for AEAT to accept it is not
   recorded; the plan checks it, and AEAT's live question in step 4 refuses a seal that lacks it.

**Who may do what.** Anyone who can see the card may **Show request** (it holds no secret). Making a
request, installing the seal and cancelling are refused, as **Replace certificate** is, unless the
box files records and the person has `system.manage` and signed in recently
(`apps/server/src/fiscal-certificate-api.ts:91-96`). A box that does not file shows neither button.

**Where the waiting key lives.** In the box's store of secrets, as a new kind of entry beside the
installed certificate (`purposes.ts:10-25` gains it), locked like every stored secret
(`classification.ts:376-379`). A restore from a backup taken after the request brings it back. **A
restore from an older backup, or a reset, loses it**: a seal FNMT then issues can never be used, and
a new request has to be made and paid for. The design says this on the card's request block: "Keep
this box's data: the seal FNMT issues works only with the key kept here."

**Cancel request** asks first: "Cancel the seal request? The box deletes the key it made for it. A
seal FNMT issues for this request can then never be used, and you would have to request and pay for
another." **Keep request** / **Cancel request**.

**Renewal is the same flow.** FNMT has no renewal (`:205-206`) but allows two live seals at once
(`:208-210`), so a new seal can be ordered while the old one files. Each request makes a new key. The
seal's expiry warning (from 90 days, `packages/fiscal-verifactu/src/certificate-dates.ts:10`) gains:
"Request a new seal on this card. You sign FNMT's contract with your representative certificate, so
check it is still valid."

## Words on the screens (English; Spanish follows in the plan)

| Where | Text |
| --- | --- |
| Card button | Request a company seal |
| Dialog title | Request a company seal |
| Dialog intro | The box makes the seal's key and a request for FNMT. The key stays on this box: nobody can download it. Your current certificate keeps filing until the seal replaces it. |
| Dialog rows | Company: BAR LUCÍA S.L. · Tax ID: B12345678 |
| Dialog button | Make request |
| After making it | Copy this request into FNMT's seal form. **Copy request** · Open FNMT's form · the steps (step 2 above) |
| Card block | Seal request waiting for FNMT. Made {date}. Keep this box's data: the seal FNMT issues works only with the key kept here. **Show request** · **Install the issued seal** · **Cancel request** |
| Install dialog | Choose the certificate file FNMT gave you. · **Save** ("Checking with AEAT…" while it works) |
| Refusal, wrong request | This certificate was not made from this box's request. Choose the seal FNMT issued for the request shown on this card. |

## Two questions for the owner

**Q1 — Setup.** Recommended: setup keeps taking a certificate file, and its certificate step (both
places setup asks for it: `apps/server/src/setup-provision-input.ts:268-271` and
`apps/server/src/first-fiscal-activation.ts:77-82`) adds one line: "To use a company seal, finish setup with your
representative certificate and request the seal afterwards on the AEAT certificate card." A company
needs a representative certificate anyway to sign FNMT's seal contract
(`getting-to-production.md:189-191`). The other way, setup makes the request and waits days or weeks
at that step. That needs a new place to keep the key, because setup writes a certificate into the
box's store only in its sealing step, which takes the new database
(`apps/server/src/setup-operation-routes.ts:312-313`); and a production setup cannot finish without a
certificate (`packages/fiscal-verifactu/src/slot.ts:113`), so the box could not trade until FNMT
answered. Recommend the first?

**Q2 — The previous seal's key.** Recommended: not kept, as for every certificate today (A795 design
§3.7): the new seal has passed AEAT's check before it replaces the old one, and a second key on the
box is a second thing to protect. The other way, the box keeps the old seal until it expires and the
card offers "Go back to the previous seal". Recommend not keeping it?

## Size

About two pull requests, no migration: the server (key, request, waiting entry, install of the
issued seal, with tests), then the card and its dialogs with the guide in English and Spanish. No new
library: a trial with the `node-forge` already in `packages/fiscal-verifactu` made a key and request,
had a stand-in authority issue a certificate, packed both into a `.p12` that Node's own reader
opened, and matched certificate to key (a wrong passphrase and another key failed, as they should;
run by this design's reviewer on 2026-11-27, Node 26.13.1, nothing kept). Fiscal: the owner lands
both.
