# A1323-7 — Emergency start in the cloud needs only the master key

When this lands, nothing in Waitron shows, prints or fetches a Cloud emergency code. The pack's
first page holds the venue heading, the master key box, the key's QR code and, when the venue is on
Waitron Cloud, a second QR code that opens its Cloud address, with the address under it. The bucket
and archive pages still follow when those are set up (`backup-recovery-pack-api.ts:265-267`) until
the draft's PRs 4b and 5 remove them; the emergency page goes now. On Backups, **Print the recovery
pack** asks for the master key and prints a new pack with it; a wrong key prints nothing. The Cloud
services card and the till's card say only what to do.
**Sources.** A1323 draft PR 7, §6 (words), D12, D22–D24, O7–O9 and §4; mock-ups `04`–`06` and the
owner's page 04–06 answers; `docs/backlog/box.md` § A1323 ("the emergency start in Cloud needs the
master key typed in, and nothing else", 2026-11-21). It changes a fiscal-authority area and a Cloud
contract, so it takes the full review with two Codex angles, and the owner lands it. Line numbers
are main at c988c431bb, read, not run; notes in `~/waitron-campaign-c/a1323-7/trace.md`.

## Decisions

- **The Cloud display reader drops `codeIssuedAt`.** Cloud builds neither endpoint
  (`git grep "emergency-hosting\|codeIssuedAt" origin/main -- ':!docs'` in waitron-cloud at 6bbe23ba2
  finds nothing). D568 is still "proposed" (contract `:2244`) and makes `open` true only when the
  "address and current code exist" (`:2424-2426`), so it must change anyway. A Cloud built to today's
  text is refused as "not available" by the exact-keys check (`cloud-emergency.ts:189`), loudly.
  **Lane G is told:** drop `codeIssuedAt`, the `emergency-hosting-code` endpoint, its signing action
  (`:2359`) and budget; `open` needs the address only, and an open display always carries an address
  as `https://<host>/`; Waitron's action list (`packages/contract/src/signing/installation-proof.ts:6`,
  `:144`) drops the code action too; `emergency-copy-status` (`cloud-emergency.ts:235-296`) is
  unchanged; say whether a venue's address is fixed; the emergency-address page asks for the master
  key (§4).
- **The Cloud QR code holds the display's `address` as accepted (`https://<host>/`,
  `cloud-emergency.ts:136-158`).** It is drawn only from a fresh `emergency()` read
  (`cloud-client.ts:1128`) that is ready and open with an address — the status read's rule, which
  treats a stale read as unknown (`backup-recovery-pack-api.ts:204`) — so the pack and the card's O7
  line cannot disagree. Otherwise no Cloud QR code, and nothing is said (O9). The address is not
  secret (the public till start read carries it, `till-setup.ts:160-169`), so its `node.manage` gate
  goes (`:147-169`); the read stays before the write lock (`:311`).
- **No schema change, no reset.** `recovery_packs.parts` is JSON text with no CHECK
  (`0000_baseline.sql:1655-1662`); only inserts are checked (`recovery-packs.ts:61-67`). The
  `emergency` entry stays, meaning "printed the Cloud QR code"; `codeIssuedAt` leaves `:8`, `:28`.
  Older `included` entries had the address QR too (`backup-recovery-pack-parts.ts:98`). The address
  is not recorded: nothing real has changed one (Cloud has issued none), the contract does not say it
  can, and PR 9's settings document plans `cloudAddress`.
- **One Cloud reason (O7):** the latest pack has no `included` Cloud entry while Cloud is open with an
  address, by the bucket's "set up after" rule (`backup-recovery-pack-status.ts:88-90`). The code
  reasons, `codeIssuedAt` in the answer (`:61`, `:222-225`) and the card's "could not be checked" line
  go (`:40-43`, `:106-117`; card `:370-373`).
- **A wrong or malformed key is restore's refusal.** Export `checkMasterKey`
  (`operation-authentication.ts:138-149`, through `authorityFrom` `:122-131`), so a malformed key
  is refused as a wrong one, as restore does (`:63-66`): `promotion.break_glass_invalid` with
  `keyName` (`:30-32`), mapped to **401** as the conflict route does (`conflict-recovery-routes.ts:119`).
  Checked in the pack's transaction before drawing, under the live-operation limiter
  (`live-operation-rate-limit.ts`, as `live-module-operation.ts:17`; `recovery.rate_limited` → 429,
  worded on the dashboard as `conflict_recovery.limited` is). Fresh sign-in stays. Print's answer
  carries no `X-Waitron-Master-Key*` headers (`:340-345`). (2026-11-26, final review: Print
  instead refuses with Change the backup key's `master_key.wrong`, 403, through the shared
  `checkTypedMasterKey`. 2026-11-27, A1323 PR 4f: that code is now `promotion.break_glass_invalid`.)
- **No current master key:** the card offers only **Make a new master key**, which needs no old key
  (D12); the route refuses with no key name.
- **The pack that holds the key is recorded.** `drawRecoveryPack` (`output.ts:55-80`) adds
  `{part: "master-key", state: "included"}` whenever it draws a key, which covers preparation and demo
  setup (`:86-117`); Live setup writes its row elsewhere (`packages/provisioning/src/first-setup-node-key.ts:199-207`)
  and gains the entry there. The holder is the newest pack with the entry since the key was made,
  else today's same-instant rule (`output.ts:40-53`) for older rows. `PARTS` (`recovery-packs.ts:26`)
  and the union (`:7`) gain `master-key`. The body becomes `{locale, masterKey}` or
  `{locale, newMasterKey: true}`; `newMasterKey: false` is refused (`api.ts:109-123`). Every draw then
  shows a key, so the named-key branch (`render-pack.ts:409-416`) and `masterKeyNamed`/`masterKeyInPack`
  (`pack-words.ts:9-11`, `:25-26`, `:42-43`) go, and `renderRecoveryPack` refuses a null key; the
  file keeps `masterKeyHeldBy` for older PDFs. The other draw site, `renderSetupRecoveryPack`
  (`fiscal-verifactu/src/setup-recovery-pack.ts:13`), always passes a key. (2026-11-26, final
  review: the entry also records the key's `masterKeyNumber` and `masterKeyName`, and the holders
  are the packs whose entry names both, plus the one pack with no entry made at the key's instant,
  ordered by pack number; the card names a received holder first, and an unreceived reprint is not
  flagged while a received pack holds the key.)
- **Left alone:** `scripts/*-client-split.json`, which nothing on main reads; Cloud's page (lane G).

## Tasks

Tasks 1–4 can start now; each leaves main typechecking and working. Task 5 waits for lane A's 4a.

- [ ] **1. The pack reads the address.** `packages/recovery-pack` loses the `emergency` kind and words
  (`pack-words.ts:2`, `:32`, `:47`, `:60-117`, Spanish); `renderRecoveryPack` takes an optional
  `cloudAddress` drawn beside the key's QR code (`render-pack.ts:375-417`). The server replaces
  `buildEmergencyPart` (`parts.ts:24`, `:49-114`) and `readPackEmergency`/`readEmergencyCheck`
  (`api.ts:56`, `:147-213`), and changes the status reasons and `recovery-packs.ts:8`, `:28`; the
  dashboard's types (`backup-api.ts:173-182`, `:193`) and card reasons (`recovery-pack-card.ts:16-63`,
  `:370-373`) follow. **Tests first:** "a pack made while connected has the Cloud QR code on its first
  page, reading back as the address" (jsQR); "a pack made while not connected has the key and its QR
  code only"; "closed or stale Cloud prints no Cloud QR code"; "a pack without it is out of date once
  Cloud is open"; "no pack or card string mentions an emergency code". **Rewritten:**
  `backup-recovery-pack-api.make.test.ts:1299-1462`, `-status.test.ts:397ff`, `-parts.test.ts`,
  `render-pack.test.ts`, `packages/db/src/recovery-packs.test.ts`, `recovery-pack-card.test.ts`.
- [ ] **2. The display drops `codeIssuedAt`.** `cloud-emergency.ts:115-123`, `:189-198`;
  `apps/server/test/cloud-emergency-fixture.ts:16`; the card's code-date row
  (`cloud-services-screen.ts:604-608`) and its type (`dashboard/src/api/cloud-api.ts:94`).
  **Test first:** "the display refuses a reply carrying `codeIssuedAt`". **Rewritten:**
  `cloud-emergency.test.ts`.
- [ ] **3. The code goes, with the card.** Server: the code read (`cloud-emergency.ts:26-113`),
  `emergencyCode()` (`cloud-client.ts:52`, `:1117-1127`), the route (`cloud-api.ts:265-282`, `:54-55`),
  both errors (`errors.ts:131-132`), the contract action, `cloud-installation-fixture.ts:18`, `:90-91`.
  Dashboard: `revealCloudEmergencyCode` and its type (`cloud-api.ts:103`, `:221`), `codes.ts:162-169`,
  `:2145-2155`, the card's code state, Show and Hide (`cloud-services-screen.ts:94-136`, `:641-666`),
  and §6's words (`strings.ts:781-810`, `:1702`, ES `:5626-5655`, `:6565`). The link keeps
  `/backup?recovery-pack=make` (`:675`). **Tests first:** "no route answers
  `/management-api/cloud/emergency/code`"; "the card has no Show code and its rows are Cloud
  address, Authorised users and the two-factor list". **Deleted:** `cloud-emergency-code.test.ts`,
  `cloud-api.emergency-code.test.ts` (its people test `:125` moves), the code half of
  `installation-proof.test.ts:234-251`, `cloud-services-screen.emergency.test.ts:135`, `:201`, `:385`.
- [ ] **4. The till's card, both sides.** Server drops `roles` (`till-setup.ts:38-55`, `:167`); the till
  drops it from `device-session-api.ts:11` and `cloud-emergency-dialog.ts:52-58`, keeping the heading,
  QR code, Open here and the owner's line, and its strings (`strings.ts:2346-2350`, `:4769-4773`).
  **Tests first:** "the till start read's `cloudEmergency` is the address only"; "the till's card shows
  the heading, the QR code, the link and one line". **Rewritten:** `till-api.setup-revision.test.ts:485-516`,
  `cloud-emergency-dialog.test.ts`.
- [ ] **5a. Print the recovery pack: server.** The body, check, limiter, holder entry, dead-branch
  removal and pack showing the key re-spelled by `encodeMasterKeyCode`, as decided. **Tests first:**
  "Print with the master key makes the next pack with the same key name, and the status names it";
  "a wrong key prints nothing, writes no row and names the key"; "a malformed key is refused the
  same way"; "with no master key, Print is refused with no key name"; "Print's answer has no
  master-key headers" (beside `make.test.ts:686`); "setup's pack is still named before any Print";
  "`newMasterKey: false` is refused". **Rewritten:** `make.test.ts:621`, `:643`, `:1046-1094` (`:1081`
  pins the same-instant rule, kept for old rows) and the cases that make plain packs as setup.
- [ ] **5b. Print the recovery pack: dashboard.** `makeRecoveryPack`'s body (`backup-api.ts:370-373`);
  the dialog's "pack" kind takes §6's text and a `wt-master-key-input` with `keyName` set
  (`wt-master-key-input.ts:239`); the card's button, the O7 line, and "Make a new master key" alone
  when there is no key. **Tests first:** "a wrong key shows the field's line naming the key"; "with
  no master key the card offers only Make a new master key". **Rewritten:**
  `client-routes.test.ts:2419-2556`, `recovery-pack-dialog.test.ts`, `recovery-pack-card.test.ts`.
- [ ] **6. Guides and docs.** EN/ES `servers.md` § `cloud-emergency` (EN `:453-476`, ES `:506-530`),
  `data-protection.md` (EN `:443-445`, ES `:478-480`), `backups.md` § `recovery-pack`,
  `docs/operations/recovery-document.md:7`, `docs/developers/cloud-connection.md:246`, and the A1323
  entry in `docs/backlog/box.md`. Run guide-links, guide-content, box-word, `live-subscriptions`,
  `alert-codes` and `errors-reachable`; look at both languages, themes and phone width.

| Screen | English | Spanish |
| --- | --- | --- |
| Pack, under the Cloud QR code | Start the venue in Waitron Cloud · {address} | Iniciar el local en Waitron Cloud · {address} |
| Backups: out of date (O7) | Recovery pack 1, made on 23 November 2026, is out of date: it has no Waitron Cloud QR code. Print the recovery pack. | El paquete de recuperación 1, hecho el 23 de noviembre de 2026, no está al día: no tiene el código QR de Waitron Cloud. Imprime el paquete de recuperación. |
| Backups button, Cloud card button | Print the recovery pack | Imprimir el paquete de recuperación |
| Print dialog text; buttons | Type your master key to print a new copy of the recovery pack. · Print the recovery pack · Cancel | Escribe tu clave maestra para imprimir una copia nueva del paquete de recuperación. · Imprimir el paquete de recuperación · Cancelar |
| Cloud card heading; status | Emergency start in Cloud · Cloud reports that emergency start is available. | Arranque de emergencia en Cloud · Cloud indica que el arranque de emergencia está disponible. |
| Cloud card first step | To start the venue in Cloud, open its Cloud address. | Para iniciar el local en Cloud, abre su dirección de Cloud. |
| Cloud card rows | Cloud address · Authorised users: · The following users have permission but still need to set up two-factor authorisation: | Dirección de Cloud · Usuarios autorizados: · Los siguientes usuarios tienen permiso, pero todavía tienen que configurar la verificación en dos pasos: |
| Till card | Start the venue in the cloud · (QR code) · Open here · You will need a copy of the current master key. · Close | Iniciar el local en la nube · Abrir aquí · Necesitarás una copia de la clave maestra actual. · Cerrar |

**Size** (estimated by reading the blocks named above, not counted from a diff): about 300 product
lines added and 500 removed; about 450 test lines added and 900 removed.

## Open questions for the watcher

- **Order with lane A's 4a.** 4a's uncommitted branch rewrites the pack route, its make test,
  `-output.ts`, the dashboard's `backup-api.ts`, `codes.ts` and `strings.ts`, and adds a second
  wrong-key code, `master_key.wrong`. **Recommend:** task 5 waits for 4a, and 4a reuses
  `promotion.break_glass_invalid` so every master-key field has one refusal. 3c (#4411) touches only
  the field and other guides.
- **The printed address.** Mock-up 05 prints it without the scheme ("es.waitron.io/v/bar-nora",
  `05-recovery-pack.html:51`, `:66`), as mock-up 06's "Cloud address" row does (`06-cloud-and-till.html:50`).
  **Recommend** printing the host alone (no `https://`, no trailing `/`) on the pack and the card,
  with the QR code and the card's link holding the whole URL. The path in the drawing is not a value
  Waitron accepts.
- **Card lines the drawing leaves out** ("Last checked", the daily price, closure reasons, the stale
  line, sign-in). **Recommend** keeping them, cutting only "Cloud checks again…" from the status and
  stale lines, and changing the permission line to "To see who can start the venue, sign in with
  permission to manage the box." (plan's words; ES to match).
- **Print dialog heading.** §6 gives none. **Recommend** "Print the recovery pack" (one name, D24).
