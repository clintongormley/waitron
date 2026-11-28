# A853 — the box makes a company seal's key itself — design

Status: written 2026-11-27 by lane L; the owner answered both questions that day (last section). Plan:
[2026-11-28-a853-seal-key-on-the-box.md](../plans/2026-11-28-a853-seal-key-on-the-box.md). Backlog:
`docs/backlog/fiscal.md`, A853.

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
   tax ID, read from the venue's record. The key is RSA, 2048 bits: FNMT's key page lists «Sello
   (RSA 2048)» for «Certificado de sello de entidad», and its form says not to request the elliptic-curve
   kind «sin autorización previa» (cert.fnmt.es/componente/generacion-claves and the seal form, both read
   2026-11-28).
2. **The request is shown** with a **Copy request** button, already without its first and last lines
   (`getting-to-production.md:184-185`; the form's own check reads a request with or without them, its
   script read 2026-11-28), and FNMT's steps in order: open the form (link), choose the seal, give the
   seal a name FNMT calls the component name, paste, sign the contract with your representative
   certificate, send the registry certificate, pay, download. FNMT's download page asks for that name
   and the request code FNMT emails you (its download form, read 2026-11-28), so the steps say to keep both.
3. **While FNMT works** (days or weeks), the card shows a block above the current certificate's rows:
   "Seal request waiting for FNMT. Made 27 Nov 2026." with **Show request**, **Install the issued
   seal** and **Cancel request**. The block takes the place of the **Request a company seal**
   button: one request at a time. Filing goes on with the installed certificate.
4. **Install the issued seal** takes the file FNMT lets the owner download: «la parte pública del
   certificado en formato .cer» (FNMT's _Manual solicitud certificado componente_, p. 16, read
   2026-11-28), no passphrase. FNMT does not say whether that `.cer` is binary or text, so the box
   takes both. The box checks the certificate was made from this box's request (it matches the
   waiting key), then runs every check **Replace certificate** runs today: dates, the tax ID when the
   seal carries one, not the one already installed, and a live question to AEAT that files nothing
   (`packages/fiscal-verifactu/src/certificate-install.ts:131-157`, `:208-222`). Only then does it
   replace the installed certificate and delete the waiting request.
5. **How it is stored.** The box keeps the seal and its key together, locked, in the same form it
   keeps today's certificate (a `.p12` file in the box's store of secrets,
   `packages/credentials/src/purposes.ts:22`), under a passphrase the box makes and never shows.
   Filing reads it as today (`packages/fiscal-verifactu/src/aeat-transport.ts:62-64`). **Not settled:**
   whether AEAT needs FNMT's issuing certificate beside the seal; no FNMT page read says. A file holding
   other certificates beside the seal keeps them, and step 4's live question refuses first.

**Who may do what.** Anyone who can see the card may **Show request** (it holds no secret). Making a
request, installing the seal, going back and cancelling are refused, as **Replace certificate** is,
unless the box files records and the person has `system.manage` and signed in recently
(`apps/server/src/fiscal-certificate-api.ts:91-96`). A box that does not file shows none of the buttons.

**Where the waiting key lives.** In the box's store of secrets, as a new kind of entry beside the
installed certificate (`purposes.ts:10-25` gains it), locked like every stored secret
(`classification.ts:376-379`). A restore from a backup taken after the request brings it back. **A
restore from an older backup, or a reset, loses it**: a seal FNMT then issues can never be used, and
a new request has to be made and paid for. The card's request block says so.

**Cancel request** asks first: "Cancel the seal request? The box deletes the key it made for it. A
seal FNMT issues for this request can then never be used, and you would have to request and pay for
another." **Keep request** / **Cancel request**.

**The previous seal is kept until it expires** (the owner's answer 2). When any install replaces a
seal (an issued one, **Replace certificate**, or going back), the box keeps the replaced seal and its
key in its store of secrets, in place of any seal kept before. Replacing a certificate that is not a
seal keeps nothing new; installing the kept seal again takes it out of the store's kept place. The
box deletes a kept seal within about an hour of its expiry. While one is kept and valid, the card
shows "Previous seal: valid until {date}." and **Go back to the previous seal**, which asks first:
"Go back to the previous seal? The box checks it with AEAT first, as it does any new certificate.
{The seal installed now is kept until it expires. | The certificate installed now is not kept: to use
it again, install its file.}" **Keep current certificate** / **Go back**. Going back runs every check
of step 4 except the request match.

**Renewal is the same flow.** FNMT has no renewal (`:205-206`) but allows two live seals at once
(`:208-210`), so a new seal can be ordered while the old one files. Each request makes a new key. The
seal's expiry warning on the card (from 90 days, `packages/fiscal-verifactu/src/certificate-dates.ts:10`)
becomes: "This seal expires on {date}. Request a new seal on this card now: FNMT can take weeks. You
sign FNMT's contract with your representative certificate, so check it is still valid."

## Words on the screens (English; Spanish is in the plan)

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
| Card row, kept seal | Previous seal: valid until {date}. **Go back to the previous seal** |
| Setup, certificate step | To use a company seal, finish setup with your representative certificate and request the seal afterwards on the AEAT certificate card. |

## The owner's answers (2026-11-27, relayed by lane L's watcher at 23:31)

**Q1 — Setup.** The owner: "Certificate file, seal later (Recommended)". Setup keeps taking a
certificate file; its certificate step (`apps/setup/src/screens/cert-screen.ts:339-340`) gains the
setup line above.

**Q2 — The previous seal's key.** The owner: "Keep it until it expires". The box keeps the previous
seal's key until that seal expires, and the card offers **Go back to the previous seal** meanwhile
(above). This replaces the recommendation of not keeping it.

## Size

Two pull requests, no migration and no venue reset (the store of secrets takes any entry name,
`packages/db/src/schema/credentials/venue-credentials.ts:17`): the server, then the card, the setup
line and the guide in English and Spanish. No new library: trials with the `node-forge` already in
`packages/fiscal-verifactu` made a key and request, had a stand-in authority issue a certificate,
packed both into a `.p12` Node opened, and matched certificate to key, with a wrong passphrase and
another key failing (2026-11-27 and 2026-11-28, Node 26.13.1). Fiscal: the owner lands both.
