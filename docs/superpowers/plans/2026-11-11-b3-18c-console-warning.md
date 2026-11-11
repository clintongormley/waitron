# B3-18c: console warning implementation plan

**Authority.** Watcher **2026-11-11 20:38**, Lane K `questions.md`: “the existing console shows the checked venue and known-Live warnings in English and Spanish”. Parent owner **2026-11-01**: “Yes, build it”. Separate Sol high authored; driver corrected after Claude’s sole read. Watcher clearance pending; no owner approval of this plan. **B3 stays 0/6.** Read [design §§5.1/7.6](../specs/2026-10-21-b3-usb-installer-design.md), [parent](2026-10-26-b3-usb-installer.md), [18a](2026-11-11-b3-18a-name-notice.md) and [18b](2026-11-11-b3-18b-firmware-return.md).

**Result/boundary.** Same console, Spanish then English together until graphics lands; no language keys. Preserve 15-second return, key/120-second idle and firmware behavior. Graphics is **deferred by the watcher (note says owner told)** to kiosk/physical work. No DBus, packages, layout/seal/schema/fiscal/storage changes or reinstall/erase/key controls.

- [ ] **Reader, TDD:** `scripts/box/installer-name-notice.mjs`/`.test.mjs` returns `null` for recognition refusal, otherwise `{tag:{name,live}|null}`. Keep bounded nonrepairing commands/canonical validation; delete unused CLI/imports. Replace sentence assertions with data assertions; cover true/false/unknown, preserving command/refusal checks and `name-tag.test.mjs` matrices.
- [ ] **Presentation, TDD:** add `scripts/box/i18n/installer.mjs` with paired templates and `formatInstallerNotice({tag}):string`; add `scripts/box/installer-presentation.test.mjs`. Only `live:true` gets the warning; false never means safe, absent/unusable means unknown. Test both languages/states and accented/maximum names; Spanish expectations read the resource.
- [ ] **Return, TDD:** update `installer-return.mjs`/`.test.mjs` to consume data/templates. Explain pause only after a key. Write notice/countdown together after raw mode, preserving first-invitation echo checks. Each English message keeps its current text on its own line; show the venue once. Output bilingual failure; thrown failure/CLI diagnostic stay English. Preserve timing, non-echo, cleanup and firmware assertions; deliberately change mocks/output expectations.
- [ ] **Package/verify:** `deploy/box/firmware-image.sh` uses `install -D` with full USB-only resource destination. Qualify packaging through the real rebuild. Leave `install-dev.sh`, `installed-start.test.mjs` and `bench/box-installer/run.mjs` unchanged, preserving English markers/reset/hash/unlock checks. Update rig README, both B3 backlog entries and parent deferral pointer.

**Exact human text** (substitute the checked name; unknown uses the fallback and status row):

| Message | Spanish | English |
| --- | --- | --- |
| Notice | Este equipo ya tiene Waitron ({name}). | This box already has Waitron ({name}). |
| Fallback name | Nombre del local no disponible | Venue name unavailable |
| Unknown status | Estado Live no disponible. | Live status unavailable. |
| Known Live | Este disco está marcado como Live. | This disk is marked Live. |
| Warning | Una reinstalación borraría los datos, las copias de seguridad y el historial de este equipo. Para recuperar los datos del local necesitarías una copia externa o un equipo de reserva; este equipo iniciaría una nueva cadena fiscal. | A reinstall would erase this box’s data, backups and host history. Recovering venue data would require an external backup or spare box; this box would start a new fiscal chain. |
| Countdown | El equipo instalado se iniciará en 15 segundos. Pulsa cualquier tecla para pausar. | Starting the installed box in 15 seconds. Press any key to pause. |
| Paused | Reinstalar, borrar e inspeccionar la clave de recuperación no están disponibles. El equipo instalado se iniciará tras 120 segundos sin escribir. | Reinstall, erase and recovery-key inspection are unavailable. Starting the installed box after 120 seconds without typing. |
| Keys unavailable | El teclado no está disponible; el inicio automático sigue activo. | Keys unavailable; automatic return remains active. |
| Failure | No se puede iniciar el equipo instalado. Retira el USB y reinicia. | Cannot start the installed box. Remove the USB and restart. |

**Checks/budget.** Observe red/green with `pnpm exec vitest run scripts/box/{installer-name-notice,installer-presentation,installer-return,installed-start,name-tag,recipe-setup}.test.mjs`; inspect complete stdout. Recreate owned inputs/native tools per rig README; run `bash deploy/box/build.sh <inputs> <new-output>`, then `B3_INSTALLER_IMAGE=<image> node bench/box-installer/run.mjs --case existing-stick --run-dir <new-dir>`. Live/unknown remain focused-test cases. No Spanish bench checks/decoder changes. Unmeasured estimate: production **+80/−30**, tests **+100/−10**, support **0**, docs **+50/−5** = **275 lines**; outside-opinion stop **413**. **3h to PR:** implementation60m, full rebuild/guest60m, review/fixes/hook60m. Whole-chain duration remains unverified; this is a forecast. At either stop, or a longer forecast, ask the watcher. Normal hook/current-head CI remain required; results go in PR/progress.
