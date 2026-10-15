# A679: one setup page, one recovery PDF

**WITHDRAWN, owner 2026-10-15 at 18:55.** The `N` namespace and removal of paper allocation history were rejected. The [two-route redesign](2026-10-15-a679-two-route-redesign.md) restores the existing S/P paper, C Cloud and E emergency requirements. The text below is the withdrawn proposal, retained as history, and is not awaiting approval.

**Proposed replacement design.** The owner’s 18:10–18:15 decisions settle the experience: the box produces one PDF to download, print, or both. The allocation policy and PDF contents recommended below still need approval. Product implementation stays paused; reusable work remains intact.

## What you see, click and keep

You connect to the box from ordinary Chrome on your networked Mac and complete the venue, administrator and readiness steps.

The setup page then shows **Keep your recovery PDF**, with **Download PDF** and **Print**. Printing to your networked HP is normal. You keep the file or sheet in the restaurant office. There is no downloaded tool, separate custodian, separate computer, passphrase ceremony or print-handling checklist.

**Recommendation:** the PDF contains your venue and box identifiers, its date and format version, the named node recovery key, short recovery instructions, and readable codes plus QR encoding. Do not include backup passwords, archive decryption keys or connection credentials; those belong to backup setup and may not exist yet when this sheet is made.

The named node recovery key gives more access than the old allocation-signing key: someone with this PDF and a usable matching backup could recover its venue data. An encrypted archive still needs its backup password. That is the privacy choice in this proposal.

The PDF says plainly: **“This sheet helps recover a backup. It does not contain your sales.”** You continue after saving or printing it; routine setup requires no transcription or recovery exercise.

Proposed mockups, **not built**: [desktop](2026-10-15-a679-simple-pdf/setup-desktop-en.png), [phone](2026-10-15-a679-simple-pdf/setup-phone-en.png), [PDF](2026-10-15-a679-simple-pdf/recovery-sheet-en.png).

## Olivo, from setup to replacement

You set up Olivo, download its PDF and print a copy for the office drawer. Separately, you configure real backups.

Months later, the box dies. You connect its replacement and choose **Recover from backup**. You select the backup, supply its connection credentials when needed, and upload the PDF or scan its printed code. Readable codes remain a fallback.

The page checks the backup’s named node key from the PDF. For an encrypted archive, you also enter its usual backup password; the PDF does not replace it. You confirm that the old box is disconnected and that you are not recovering another replacement simultaneously. Those are your declarations; the PDF cannot establish them.

Recovery restores the available backup and creates a fresh installation identity. It does not reconstruct sales missing from that backup. The replacement produces its own PDF. Keep older PDFs for backups naming older keys.

This guided page requires A731 and the allocation changes below; it is proposed behaviour, not today’s completed recovery journey. Existing node-key authentication and archive decryption are separate requirements: `apps/server/src/recovery-module-operation.ts:159`, `operation-authentication.ts:60`, and `restore.ts:156`.

If fire or burglary takes both box and PDF, you look for another ordinary saved copy and a usable backup with its matching keys. Without those keys, this design cannot promise recovery of that backup. You retain surviving records and set up a new box as a fresh, empty installation. Recovering old business data still requires its matching keys. Resetting a box that may still hold old business data remains separate A732 work, with owner proof before any such action. Keeping another copy elsewhere is optional advice, never a setup requirement.

## Names without a paper register

**Recommendation:** remove the allocation-signing key from the normal PDF entirely. Give every fresh local installation a cryptographically random 128-bit name, encoded as `N` plus 26 characters; append that identity to its invoice-series bases. Freeze it before activation, check locally known identities, and never reuse an uncertain attempt. Independent boxes have an extremely small collision probability, not guaranteed global uniqueness.

This introduces a distinct local namespace. Today’s initial paper names are `S` plus six digits; the existing 128-bit format uses `E` for emergency recovery (`packages/fiscal-verifactu/src/allocation-identity.ts:1–20`). The envelope binds sources to prefixes and excludes emergency allocations from initial setup (`allocation-envelope.ts:273–279`). Emergency preparation also accepts only restore/re-registration and reads a confirmation file (`emergency-preparation.ts:75–98`).

Therefore this recommendation needs an **explicit allocation-policy exception to H2**: add the `N` format, a local source and authority path, and corresponding preparation and guard coverage. Relevant boundaries include `allocation-identity.ts:6`, `allocation-envelope.ts:23`, `:183`, `:273`, and the collector at `allocation-operation.ts:119`. A self-issued signature cannot satisfy today’s outside-evidence requirement.

Until approved, H2 remains unchanged. SQL, fiscal writers, hashes and invoice numbering stay protected. Existing source checks and behavioural assertions remain. This proposes no Cloud allocation service or work in another lane.

## What the box retains, and what theft permits

**Recommendation:** the box generates the PDF locally. It retains operational identities, attempt history and recovery-key verifiers. One page visit has one PDF and one key: Download and Print reuse the same bytes. Raw node recovery material and PDF bytes stay only in transient memory for that delivery, ending on Continue or close; they are excluded from logs and automatic browser persistence. Explicit PDF download/printing is the intended output. Backup encryption settings keep their existing storage rules. If delivery is interrupted, or you need another sheet after the raw key was discarded, an authenticated action issues a new named recovery key and PDF, never another fiscal activation. New backups then use that key; old backups still need the old matching sheet. Unfinished setup uses its administrator-password ownership proof over trusted HTTPS; a completed setup requires an authenticated manager with `system.manage`. Reissue never activates fiscal setup again.

The existing node-key mechanism stores a verifier (`apps/server/src/break-glass.ts:24–35`); a recovery pack contains the actual secret (`recovery-pack.ts:83`).

An old allocation-signing key can sign blocks and consumption statements (`packages/fiscal-verifactu/src/paper-evidence.ts:314–334`). Those signatures still require enrolled trust and current outside confirmation (`:567–583`); that key alone does not authenticate node recovery.

The proposed PDF instead carries the named node recovery key disclosed above. Its codes or signatures prove neither a single current master, global history, an inactive old box nor absence of clones.

## Keep/change/drop inventory

“Keep” preserves the stated requirement; it does not claim implementation or validation.

| Piece | Disposition and reason |
|---|---|
| Marker repair | **Keep:** repair eligible markers without fiscal writes. |
| Password from any browser; ownership rebind | **Keep:** recover unfinished setup without the original tab. |
| Local empty Start again | **Keep:** recover an unused attempt without a technician. |
| Consumed / Not consumed / Unknown | **Change:** retain for existing signed allocations; local names need no register and uncertain names stay unavailable. |
| Missing database; fresh workspace | **Keep:** preserve remnants and allocate a fresh identity. |
| Exact committed Finish setup | **Keep:** finish publication without activating twice. |
| Retirement audit | **Keep:** preserve abandoned and uncertain attempts. |
| Direct, supervised, already-recovery entry | **Keep:** provide the same resolution page. |
| Fixed EN/ES copy | **Keep:** understandable, consistent actions. |
| A731 backup recovery from page | **Keep:** required before go-live for the illustrated journey. |
| A732 custodian-signed fresh deployment | **Change:** new boxes use normal fresh setup without a custodian; resetting retained business data still needs owner proof and a separate design. |
| A733 TLS restoration | **Keep:** restore trusted HTTPS before accepting secrets. |
| Module boundary; public protocol | **Keep:** modules own fiscal rules; preserve existing optional imports without adding a compatibility layer. |
| Encrypted key file, secret-paper codecs, PBKDF | **Change/drop:** reuse suitable encoding checks; drop separate encrypted signing-file and passphrase requirements. |
| Offline tool/download | **Drop:** setup supplies the PDF. |
| Current master, ink reservation/consumption, manual fingerprint comparison | **Drop** from the local route; existing import checks remain. |
| File-and-paper gate; routine hand-typing | **Drop:** one saved or printed PDF suffices. |
| Frozen IDs; concurrency | **Keep:** prevent competing attempts and duplicate activation. |
| Trust/current evidence | **Change:** retain for imports; explicitly replace outside authority for the proposed local route. |
| Separate readiness | **Keep:** preparation must not consume production identities. |
| Public import; Cloud | **Keep:** existing optional import capability; no new fetching service. |
| Actual wizard; configuration import | **Keep:** integrate the PDF and preserve existing configuration checks. |
| Interruption/replay | **Keep:** distinguish committed completion from a fresh attempt. |
| Handover and loss-stop drills | **Drop:** no custodian transfer ceremony. |
| Native visuals/accessibility | **Keep:** usable EN/ES screens, phone layouts and PDF. |
| Old reviews/physical gates | **Change:** old reviews cover their original candidate only; replace 44 steps and FOLLOW-UP with opening the PDF and checking recovery from downloaded or printed output. |

Do you approve this full design, including the explicit `N` allocation-policy exception, removal of normal allocation custody, and the privacy choice of placing the named node recovery key in the PDF while leaving backup passwords separate?