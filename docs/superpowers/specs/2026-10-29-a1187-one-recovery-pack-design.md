# A1187: one recovery pack

**Approved by the owner on 2026-10-29 (~10:30 CET): "Approve."** Every §11 default stands except
item 4: the authenticator code is asked for only when the person has one set up (owner, ~10:20 CET:
"No, authenticator is optional."), which is what B3 already says. Nothing is built yet. Revised the same day after a
fresh review (three critical findings, seven important, five minor, all folded), and again after a
narrow check of the corrections (seven points, all folded). Decisions marked
**(owner)** quote the owner. Decisions marked **(default)** are this design's, open to the owner's
correction. Everything else is a fact about the current code or documents, with a pointer; each says
whether it was read or run.

## What the owner asked for

The backlog entry (`docs/backlog.md`, A1187, owner 2026-10-29):

> "It should be a single recovery pack. So there's one document that covers everything that they
> need to know." Merge today's recovery kit, the recovery sheet with the disk key and the archive
> recovery pack into one document, and add the venue's emergency address and emergency code from
> Waitron Cloud (A1188).

It comes from the Cloud billing design's §7, item 3: "Waitron produces a single recovery document
holding everything an administrator needs when things go wrong. It includes the venue's emergency
address and emergency code" ([Cloud billing design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-29-cloud-billing-design.md#7-emergency-hosting-when-the-owner-cannot-be-reached), Cloud #705).

## Words used here

- **The pack**: the one document this design makes. A printable A4 PDF.
- **A part**: one thing the pack carries, with its own page: the disk key, the emergency start, the
  bucket copy, the archives and the server key.
- **The backup key**: the key every archive is locked with; it also seals the server's secrets that
  the bucket copy carries (`apps/server/src/sealed-state.ts:34-47`). The box keeps it in
  its settings file as `WAITRON_BACKUP_RECOVERY_KEY` (`apps/server/src/backup-config.ts:227-229`).
  Today's screens call it "the recovery key".
- **The server key**: the key the recovery PDF prints today (the code calls it the node key). The
  box keeps only a check value made from it (a one-way hash), so the key itself can be printed only
  once. Today's PDF calls it "Waitron recovery key", so today two different keys share one name; the
  pack gives them two.
- **The disk key**: the 64-letter key that opens the box's encrypted disk when its security chip
  will not (B3 design §7.5). Not built.
- **The emergency address and code**: from A1188. The address leads to Cloud's code page; the code
  starts a locked copy of the venue in the cloud ([A1188 design](2026-10-29-a1188-cloud-emergency-start-design.md), "Words used here").
- **A restore code**: one long line a restore asks for. Today there are two: the recovery kit's
  (`WAITRON-RECOVERY-KIT-1:…`) and the archive pack's (`WAITRON-ARCHIVE-PACK-1:…`).
- **A filing box**: a box that records invoices for the tax agency (Veri\*Factu). Restoring one
  needs the server key as well as the backup (`deploy/README.md:531-535`).

## The evening this is for

The box at Bar Nora has stopped. Marta, the administrator, opens the drawer in the office and takes
out one envelope: the recovery pack. Its first page has a table: "The box asks for its disk key →
page 2. The box is dead and you need to sell tonight → page 3. You are setting up a new box from the
bucket → page 4." She turns to page 3, opens the emergency address on her phone, types the code, and
follows A1188's steps. Next week, setting up the replacement box, she chooses the same pack, saved
as a PDF on a stick, wherever the setup page asks for a recovery file.

Today she would need three documents kept in three places, two of them text files on somebody's
computer.

## What exists today

Read, not run, except where a line says it was run.

| Document | What it holds | How it is protected | How it is used |
| --- | --- | --- | --- |
| **Recovery kit** (Backups → "Continuous copy to your bucket" → **Show recovery kit**). Made by `encodeRecoveryKit` (`packages/stream/src/kit.ts:22`), served by `GET /api/backup/stream/kit` (`apps/server/src/stream-api.ts:275-299`). | One restore code: the venue id, the bucket's address and **secret access key**, the **backup key**, and the server's public signing key (`kit.ts:14-20`). | Needs `system.manage` (`stream-api.ts:104-109`); reply marked not to be stored (`:287`). Shown again whenever asked; Copy, or **Download kit file**, a text file `waitron-recovery-kit-<fingerprint>.txt` (`apps/dashboard/src/screens/stream-settings-panel.ts:612-618`). Shown by itself after a Save (`:534-535`) and after a key change, with "Keep the old kit for seven days" (`:380-410`, `apps/dashboard/src/i18n/strings.ts:1897-1898`). No record that it was shown. | Setup's **Restore from my bucket**, which takes the kit file or the pasted line (`apps/setup/src/i18n/strings/restore.ts:75-83`), and `restore --from-bucket <kit-file>` (`deploy/README.md:524-539`). |
| **Archive recovery pack** (Backups → **Archive recovery pack**, only when a destination is a bucket). Made by `encodeArchiveRecoveryPack` (`apps/server/src/archive-recovery-pack.ts:59`), served by `GET /api/backup/archive-recovery-pack` (`apps/server/src/backup-api.ts:506-553`). | One restore code: the archive format, the venue id, the bucket's address and **secret access key**, the archive folder and the **backup key** (`archive-recovery-pack.ts:14-23`). | Needs `system.manage`; not to be stored (`backup-api.ts:545`); nothing of it logged (`:504-505`). Shown again whenever asked; taken off the screen when the key or settings change (`apps/dashboard/src/screens/backup-screen.ts:969-980`). No record that it was shown. | Only `restore --from-archive <pack-file> --archive-key <name>` (`deploy/README.md:550-566`); a search of `apps/setup` for it found nothing. |
| **Recovery PDF**, the "recovery sheet" (setup's first-hour step **Prepare recovery PDF**, `packages/fiscal-verifactu/src/setup/first-hour.ts:91-98`; later Backups → **Recovery PDF** → **Create recovery PDF** → "Replace the recovery key?"). Drawn by the fiscal module (`packages/fiscal-verifactu/src/recovery-pdf-content.ts:14`) through the module seat `recoveryDocument` (`packages/module/src/module.ts:1546-1555`), which takes the new key's secret and returns a whole PDF. | Legal name, NIF, venue, environment, software id, server id, key name, created; the **server key**; three warnings; one attached file, `waitron-recovery-key-v1.json`, holding the key again (`recovery-pdf-content.ts:102-141`). | Needs `system.manage`, **and** an encrypted connection; when the browser names where the request came from (`Origin`, `Sec-Fetch-Site`), it must be this same origin; and a JSON body (`apps/server/src/recovery-document-api.ts:30-43`): the strictest of the three. The box keeps only the key's check value, so **every new PDF makes a new key**. The PDF stays in memory until the next key change (`:85-119`); each new key logs `recovery.document_reissued` with the person's id (`:119`). Setup records that the PDF was kept, tied to a digest of the module's own document (`packages/provisioning/src/first-setup-recovery-delivery.ts:23-29`, `:280-310`). | Restoring a filing box: setup reads the key back from an uploaded recovery PDF (`packages/fiscal-verifactu/src/setup/recovery-key.ts:163-165`), and that reader **refuses a PDF with any attached file but the one key file** (`packages/fiscal-verifactu/src/recovery-reader.ts:51`, `:81`, `:101`). The review **ran** `vitest run src/recovery-reader.browser.test.ts -t "conflicting"` in `packages/fiscal-verifactu`: 2 passed, one refusing a second attachment, the other a hidden second copy inside the one file. The reader also refuses a key file carrying any other secret (`recovery-reader.browser.test.ts:103-104`). |

More facts the pack must fit:

- **Both restore codes carry the same backup key.** Both routes read `WAITRON_BACKUP_RECOVERY_KEY`
  from the box's settings file (`apps/server/src/boot.ts:2233-2234`, `backup-api.ts:530`,
  `backup-config.ts:227-229`).
- **The backup key is also shown on its own**: by **Show the current key** in the key change
  dialog (`GET /api/backup/recovery-key`, `backup-api.ts:492-498`; `backup-screen.ts:2068-2095`),
  and once, newly made, when backups are turned on on a box that has no key yet
  (`backup-screen.ts:1837-1851`). Archives in a **local folder** are restored
  with setup's "Backup file" and "Recovery key" fields (`apps/setup/src/i18n/strings/restore.ts:44-51`),
  which take that key, not a restore code.
- **Older backups need older keys, of both kinds.** For the backup key: "Backups taken before now
  still need the OLD key" (`strings.ts:1822-1823`). For the server key: "Keep the older paper until
  every backup made before the replacement has been deleted" (`deploy/README.md:570-575`). The box keeps 7 archives or 30 days by default
  (`backup-config.ts:42-43`), and an owner can raise both; it deletes old archives only after storing
  a new one, and earlier when the disk runs short (`apps/server/src/backup-sweep.ts:108`, `:271`,
  `:323-352`). An archive's name carries its time but not which key locked it
  (`backup-keys.ts:34-43`). The kit's "seven days" is the bucket copy's rule only.
- **The backup key's label** is the first 8 hexadecimal characters of a plain SHA-256 of the key
  (`apps/server/src/backup-supervisor.ts:179-181`).
- **The bucket restore code is long.** Built with realistic values in plain Node (`JSON.stringify`
  then base64url, as `encodeRecoveryKit` does), it **ran** to 602 characters; the review measured a
  sample at about 640. A search of `apps/setup` by the review for `BarcodeDetector` or
  `getUserMedia` found no camera scanning.
- **No dashboard step asks for a fresh sign-in at the button.** The nearest,
  `withAuthenticatedOperation`, takes a password and an optional code, for `node.promote` and
  `mirror.create` only (A1188, "What exists today").

**Not built:**

- **The disk key.** A search of `deploy/`, `apps/`, `packages/` and `scripts/` for `LUKS`,
  `diskKey`, "disk key", `cryptsetup`, `clevis` and `tpm2` found nothing. The B3 design describes
  it (`2026-10-21-b3-usb-installer-design.md:595-640`): every later sheet includes a section «Clave
  de recuperación del disco» with the disk's id (LUKS UUID), the box's identity and the key as text
  and as a QR code; a later sheet is printed only after an administrator signs in again with
  password or passkey **plus** an enrolled authenticator code (`:631-632`: "plus enrolled TOTP, as
  in §11"; §12.2, `:1154-1155`: "plus enrolled TOTP … when present"); the first is delivered over a one-time channel
  from the box's host service before any administrator session exists (`:620-630`); each delivery is
  recorded outside the venue database (`:633-634`); the key is never in the venue database or its
  backups; and "never present a complete sheet missing its required disk section" (`:637`). The
  sheet also carries the unlock address, the box's certificate fingerprints and their end dates
  (`:678-680`).
- **The emergency address and code.** A1188 designs them; nothing is built. The box learns three
  facts (whether the start is open, the address, the daily price) and **never stores the code**;
  the dashboard fetches the code, with its issue date, when someone presses **Show code** (A1188
  §1-§2). A1188's **Print recovery pack** button prints this pack, and "until A1187 lands … a
  one-page card with the three" (A1188 §2).

**Two more recovery documents, outside the owner's list:** the **node recovery pack**
(`apps/server/src/recovery-pack.ts:30`), whose panel `dashboard-node-recovery` is on no screen (the
only other mention, `backup-screen.test.ts:47`, asserts it is absent); and the **break-glass code** a
mirror shows once when it joins (`apps/setup/src/screens/done-screen.ts:158-181`), made only by an
adopt (`apps/server/src/adopt.ts:152`, through `setup-api.ts:1011`): the joining server's own
server key.

## 1. One document, a page per part

**(default)** The pack is one A4 PDF. Its pages:

1. **Cover.** The venue's legal name, tax id and venue name; when and by whom the pack was made;
   its number (the first pack is 1). A table **"Which page do I need?"**, one row per situation,
   each pointing at a page. A table **"What is in this pack"**: each part and the date it last
   changed, so a person can match a printed pack against the dashboard (§4). The warning: anyone
   holding this pack can open every backup and start the venue elsewhere; keep it locked away, off
   the box; and **which older packs to keep** (§4).
2. **The disk key**, on a box with an encrypted disk: B3's section as B3 designs it.
3. **Emergency start in the cloud**: the emergency address, the code, the date the code was issued,
   who can use it (A1188's card's list), and A1188's steps in five lines.
4. **The bucket copy**: the kit's restore code as text and as a QR code, the bucket's name, the
   steps for **Restore from my bucket**, and on a filing box "You also need the server key: page 6,
   or the pack it names."
5. **The archives**: for a bucket, the archive restore code and the `restore --from-archive` steps;
   for a **local folder**, the backup key itself and the steps for setup's Restore from backup. The
   same server-key line as page 4.
6. **The server key**: the recovery PDF's rows, the key when this pack carries a new one (§2), and
   its warnings.

A part that does not apply, or could not be drawn (§5), still has its line on the cover saying why
("This box has no bucket copy", "This venue is not connected to Waitron Cloud", "This venue files
no invoices with the tax agency"). A reader never wonders whether a page fell out.

**(default) One attached file for every restore.** The PDF carries one attached file,
`waitron-recovery-pack-v1.json`, holding both restore codes, the backup key where page 5 prints it,
and the server key when the pack carries one. Every recovery file field then takes the pack PDF
itself: setup's recovery-PDF reader, setup's **Recovery kit file**, and the restore command's
`--from-bucket` and `--from-archive`. So "choose this PDF" is the one instruction. The restore codes
inside it stay exactly today's codes, so today's checks on them do not change; the old kit and pack
files are still accepted. A QR code beside each code lets a phone read it and paste it; typing a
600-character code is not offered as a way in.

This changes the fiscal module's reader, which today refuses any attachment but the key file
(`recovery-reader.ts:51`, `:81`, `:101`) and a key file carrying any other secret
(`recovery-reader.browser.test.ts:103-104`): it would accept exactly one of the two files, the old
key file or the new pack file, and read the server key from either. Neither refusal states its
reason, so the build first finds out what each protects before the reader accepts a file holding the
restore codes and the backup key; if that cannot be done safely, the alternative below applies.

Alternative: attach only today's key file, only when the pack carries a new key, and print the
restore codes without attaching them. Cost: no reader changes, but a bucket restore needs the old kit
file or a code pasted from a phone, so the pack is not the one file the setup page asks for.

## 2. The server key: printed once, named after

The server key is the one part the box cannot print twice. If every pack made a new key, printing a
pack only to pick up a new emergency code would replace the key, and every older backup would then
need the older paper.

**(default)** Making a pack does not replace the server key. Page 6 names the key in force (its name
and the day it was made, which the box keeps) and says "The key itself is on recovery pack <n>,
made on <day>. Keep that pack." The make-pack dialog offers **Also make a new server key**, with
today's warning; ticked, the new key is printed on page 6, carried in the attached file, and the old
key stops working as today. The first pack, made at setup, always carries the key (§6).

This changes the fiscal module's seat: today it takes a new key's secret and returns a whole PDF
(`module.ts:1546-1555`), and its drawing refuses anything not shaped as a 32-character key
(`packages/fiscal-verifactu/src/recovery-key-code.ts:13`). It would gain a variant that draws page 6
without a new key, and return its page for the host to put into the pack. That is a change to a
contract between packages, so the build takes the full review.

Alternative: every pack makes a new server key, as today's PDF does. Cost: every printed pack
retires the key, and older backups need older packs every time.

## 3. Who may make it, and how

The pack holds every secret the venue has. **(default)** Making one (except the first, §6) needs:

- `system.manage`, which every one of today's three documents needs;
- the recovery PDF route's checks: an encrypted connection, and this same origin whenever the
  browser names where the request came from (`recovery-document-api.ts:30-43`);
- **a fresh sign-in at the button (owner, 2026-10-29)**: password or passkey, plus the
  authenticator code only when the person has one set up — never a refusal for having none. This is
  B3's rule for a later disk key (`b3 design:631-632`, and §12.2 at `:1154-1155`: "plus enrolled
  TOTP … when present"). **No such step exists today; the build makes one.**

The emergency code is printed only when the person also holds `node.promote`, who alone sees it on
A1188's card (A1188 §2); for anyone else page 3 says "Made by someone who cannot start the venue in
the cloud; the code is left out." An administrator holds both.

**(default)** The server builds the pack and hands it to the browser once, marked not to be stored.
It keeps no copy and logs none of its contents. It logs one line naming who made pack number N and
which parts it held. A disk-key page is also recorded by the host service outside the venue
database, as B3 requires.

**(default) Built from parts.** Each part is drawn by the code that owns its secret: the stream and
backup code draw pages 4 and 5; the fiscal module draws page 6 through its seat (§2), so generic
code never learns Veri\*Factu; the host service draws page 2 (B3); the Cloud connection draws page 3
(A1188).

## 4. The box remembers the pack, never its contents

**(default)** For each pack the box keeps a record: its number, who made it, when, and for each part
a value that changes when the part changes — the backup key's latest change time
(`WAITRON_BACKUP_KEY_ROTATED_AT` in the box's settings file, `apps/server/src/backup-config.ts:255-256`;
when nothing has set it, the pack's own time stands in) and the bucket settings' revision; the server key's name; the disk's id; the emergency code's
issue date. **Not** the backup key's 8-character label: the record travels into every backup, and
that label is a fast hash, so it would let someone holding a backup test guesses at a short key far
faster than the backup's own slow lock allows (the box accepts a backup key as short as 12 characters,
`MIN_PASSPHRASE_LENGTH` at `apps/server/src/recovery-bundle.ts:7`).

The Backups card then says one of:

- "Recovery pack 3, made on 12 October by Marta Puig, is up to date."
- "Recovery pack 3 is out of date: the backup key changed on 20 October. Make a new pack. Keep pack
  3 until about 19 November, when the last archive made with its key should be deleted, and any
  copies you keep yourself. Keep pack 1: it holds the server key." The keep-until date is the later
  of seven days (the bucket copy) and an estimate: the latest date the box expects the last archive
  made before the key change to be deleted, worked out from the archive names' times, the key's
  change time and the keeping settings. It assumes backups keep running; it does not cover a
  destination that stopped receiving backups, or copies kept elsewhere, so the line says so.
- "No recovery pack has been made on this box."

The line never advises discarding the pack that holds the server key in force. A pack holding a
**replaced** server key gets the same kind of keep-until date, from the server key's replacement
time, because older backups restore the older server key (`deploy/README.md:570-575`).

**(default) The emergency code's issue date becomes a fourth fact the box learns from Cloud**, beside
A1188 §1's three, never the code itself, so a new code from the Cloud account marks the pack out of
date without anyone pressing **Show code**. This adds to A1188 §1, which the owner approved with
three facts. Alternative: the card notices a new code only when someone presses Show code; cost: a
pack can be out of date on the evening it is needed with no warning.

## 5. When a part cannot be drawn

- **A part fails** (for example the archive settings cannot be read): the pack is still made; that
  page says what failed and what to do, and the card marks the pack incomplete. Printing the disk
  key and the server key should not wait on an unrelated part.
- **Except the disk key** on a box with an encrypted disk: B3 forbids a sheet missing it, so the pack
  is refused, with the cause, **Try again** and **Stop**.
- **The backup key is too short or missing**: pages 4 and 5 carry today's refusal and its link to
  the setting that fixes it (`backup.recovery_key_too_short`, `backup.recovery_key_missing`).
- **Cloud does not answer** for the emergency code: page 3 says "Waitron Cloud did not answer when
  this pack was made; make a new pack when it does", and the card marks it out of date.
- **No fiscal module**: no page 6; the cover says the venue files no invoices with the tax agency.

## 6. Where it appears

- **Backups screen.** One card at the top, **Recovery pack**, with the status line (§4) and **Make
  recovery pack**. It replaces the **Recovery PDF** card, the **Archive recovery pack** card and the
  stream card's **Show recovery kit**. After a bucket Save or a key change, where the kit appears by
  itself today, the card's line turns to "out of date". **(default)** The two restore codes are no
  longer shown on screen; the key change dialog's **Show the current key**, and the new key shown
  once at turn-on, stay, because that is where the key is set and changed.
- **A1188's emergency card.** Its **Print recovery pack** opens the same dialog.
- **Setup.** The first-hour step **Prepare recovery PDF** becomes **Make recovery pack**, with the
  same "I kept it" tick. It is made without §3's fresh sign-in, because no administrator session
  exists yet: under B3's first-delivery rule for the disk key and today's setup rule for the rest.
  The delivery record covers the whole pack's digest, and the fiscal module still checks its own
  statement. Most parts do not exist yet, so the first pack holds the server key and, on a B3 box,
  the disk key; the cover lists the rest as "not set up yet".
- **A box restored at setup** keeps the server key from its backup, so its first pack does not make
  one: page 6 names the key the restore selected (the name `restore.recovery_key_selected` logs,
  `apps/server/src/restore.ts:329`) and says which older paper holds it.
- **A mirror's break-glass code** stays on its Done screen as today.

## 7. Language and paper

**(default)** The pack is printed in the language of the person making it, English or Spanish, as
the dashboard already is; restore codes and addresses are the same in both. One A4 page per part,
readable in black and white, every secret as text with its QR code beside it.

## 8. Fiscal facts

Nothing here changes a fiscal record, the chain, invoice numbers or what is sent to AEAT. The fiscal
module's files do change: its seat gains the page-without-a-new-key variant (§2), its reader accepts
the pack's attached file (§1), and its warning "A downloaded backup file needs its own password. Keep
these separately from this sheet" (`recovery-pdf-content.ts:129-132`) is reworded, because the pack
holds that password. §2 changes only **when** a new server key is made.

## 9. Left open

- The node recovery pack, which no screen shows: retire it or fold it in, when its item is next
  worked.
- A mirror's own recovery pack.
- One restore code for both restores, instead of two in one file.
- The Spanish wording of the mock-ups is a draft; the exact words of every refusal are written at
  build time under CLAUDE.md's refusal rule.

## 10. How it would be built

| Part | What | Needs |
| --- | --- | --- |
| 1 | The pack with today's parts (bucket copy, archives, server key with §2's checkbox); the attached file and every reader taking the pack (§1); the fiscal seat and wording changes (§2, §8); the record and the card (§4); the fresh sign-in at the button (authenticator code only when one is set up), which does not exist yet (§3); setup's first pack (§6) | Nothing unbuilt |
| 2 | Page 3, the emergency start, and the fourth fact (§4) | A1188 part 1, and Cloud sending the code's issue date |
| 3 | Page 2, the disk key | B3's slice 8 (the retained disk key) |

Part 1 alone gives the owner's "one document" for everything built today. It changes a contract
between packages and the fiscal module's reader, so it takes the full review.

## 11. The owner's question

**Approve this design, with its defaults?** Each default says the alternative and its cost.

1. **One A4 PDF, a page per part, a cover that says which page to use** (§1). Alternative: one long
   page. Cost of the default: more paper.
2. **One attached file, and every restore takes the pack PDF itself** (§1). Cost: the fiscal
   module's reader and two restore fields change. Alternative: only the key file attached, codes
   printed; cost: a bucket restore still needs the old kit file or a code pasted from a phone.
3. **Making a pack does not make a new server key unless you tick the box** (§2). Cost: page 6 of
   most packs points to an older pack. Alternative: every pack makes one; cost: older backups need
   older packs every time a pack is printed.
4. **A fresh sign-in at the button** (§3). **Changed by the owner, 2026-10-29:** password or
   passkey, plus the authenticator code only when the person has one set up. The earlier text here
   said a person with no authenticator could not make a pack; that misread B3, whose rule asks for
   the code only when one is enrolled. Cost: the step has to be built.
5. **The emergency code only for people holding `node.promote`** (§3), following A1188.
6. **The box keeps a record of each pack, never its secrets, and says when it is out of date and
   which packs to keep** (§4). Alternative: no record, as today.
7. **The box also learns the emergency code's issue date from Cloud** (§4), a fourth fact beside
   A1188's three. Alternative: notice a new code only at Show code.
8. **A part that fails marks its page; only a missing disk key refuses the pack** (§5).
9. **The screens stop showing the two restore codes; the backup key's own screens stay** (§6).
   Alternative: keep Copy on screen beside the pack; cost: two places a code can be copied from and
   left behind.
10. **The pack is in the language of the person making it** (§7).

## Mock-ups

In `docs/backlog/mockups/a1187-recovery-pack/`:

- `01-pack-en-page-<n>.png` and `01-pack-es-page-<n>.png`: a sample pack's six pages, English and
  Spanish, A4 (sample values, not real keys).
- `02-backups-card-<theme>-<width>.png`: the Backups screen's new card, out of date, light and dark,
  1280 and 390 wide.
- `03-sign-in-<theme>-<width>.png`: the make-pack dialog with the fresh sign-in, for a person who has
  an authenticator set up; for a person with none, the code field is not shown (§3).
