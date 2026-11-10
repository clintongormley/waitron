# A1315: device profile guide plan

Request, recorded in the driver's task and `docs/backlog/dashboard.md#a1315-bring-every-help-bubble-down-to-orientation-one-area-per-pr`: "Help bubbles orient — missing guides". "Missing guide destinations remain in docs/backlog/dashboard.md#a1315-bring-every-help-bubble-down-to-orientation-one-area-per-pr, with A1247's existing primitive work retained."

Finish line: staff can find how to switch this device's profile in Table service's page contents, EN/ES, with shared heading id `{#device-profile}`. Keep the two-sentence bubble. This is lane D's scoped slice, without lane K's plan constraints.

## Sources read before wording

Readings, not runtime verification: the app offers profiles, refuses an unsent order, attempts draft saving and requests a switch; the server checks approval, admission and payments.

| Receipt | What this plan reuses |
| --- | --- |
| `apps/till/src/widgets/till-shell.ts:1008-1014,1070-1072,1193-1239,1275-1277` | Both handheld and till put Profile directly in More, alongside Settings. |
| `apps/till/src/widgets/profile-dialog.ts:99-134`; `apps/till/src/i18n/strings.ts:323,853-857,2305,2813-2817` | Chooser, action and existing EN/ES labels. |
| `apps/till/src/till-app.ts:10453-10545`; `apps/server/src/device-api.ts:489-503`; `apps/server/src/device.ts:248-258,294-331` | Switch call chain: park/clear first; approved and admitted profile; payment stop. |
| `apps/server/src/guide/en/table-service.md:470-492`; `apps/server/src/guide/es/table-service.md:498-520` | Existing `{#device-zones}` section already explains profile-local saved zones; link without repeating it. |
| `packages/ui/src/components/wt-menu-row.ts:33-46`; `docs/backlog/dashboard.md:527-528`; `apps/server/src/guide-pages.ts:187-190` | A1247 keeps table/tabs/menu-row APIs unchanged. Reach this section through Table service's contents; there is no generated Contents menu or menu-row guide link. |

## One documentation task, after clearance

- [ ] Add the following section immediately before `{#device-zones}` in the two existing guides. **Before, EN/ES:** no device-profile section. **After, EN:**

```markdown
## Switch this device's profile {#device-profile}

When you need to use this device with another profile, open **More** (☰) and choose **Profile**.
Choose a different **Device profile** and tap **Switch**. You can switch to a profile approved
for this device that you are allowed to use.

Before switching, park or clear the order in progress and finish any payment in progress.
To choose which zones this device shows, see
[Choose the zones this device shows](table-service.md#device-zones).
```

**After, ES:**

```markdown
## Cambiar el perfil de este dispositivo {#device-profile}

Cuando necesites usar este dispositivo con otro perfil, abre **Más** (☰) y elige **Perfil**.
Elige otro **Perfil de dispositivo** y toca **Cambiar**. Puedes cambiar a un perfil aprobado
para este dispositivo que tengas permiso para usar.

Antes de cambiar, aparca o vacía el pedido en curso y termina cualquier cobro en curso.
Para elegir qué zonas muestra este dispositivo, consulta
[Elegir las zonas que muestra este dispositivo](table-service.md#device-zones).
```

Bubble before = after (`apps/till/src/i18n/help-strings.ts:37-38,100-101`): EN "Switches this device to another profile it is approved for. Park or clear the order in progress first." ES "Cambia este dispositivo a otro perfil para el que está aprobado. Antes, aparca o vacía el pedido en curso."

- [ ] When built, update A1315 in `docs/backlog.md`: before "Some help still has no guide section to link."; after "Equipment, department transfers, Fix my hours and zone Reset still need guide sections." In `docs/backlog/dashboard.md`: before "the guide has no section on a device's profile, equipment, department transfers or Fix my hours, nor on a zone's Reset."; after "the guide has no section on equipment, department transfers or Fix my hours, nor on a zone's Reset." Retain the heading/shared anchor, root rule/Detail links and A1247 Decisions. Backlog copy is English only. Do not edit it during plan publication.
- [ ] Run from root: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` (rendering, links, EN/ES section order) and `pnpm exec vitest run scripts/guide-links.test.ts` (existing app destinations/writers). Require passing test counts. Neither checks wording accuracy. Changed assertions: none. No new tests, prose pins, harness or TDD: documentation only.
- [ ] Run `git diff --check` and `pnpm exec prettier --check apps/server/src/guide/en/table-service.md apps/server/src/guide/es/table-service.md`. Check copy against receipts, relative zones links, both anchors and the four remaining backlog topics. Include EN/ES before/after and receipts in the change description.

Expected lines: guides +10/-0 each; root backlog +3/-3; detailed backlog +2/-2; this plan +59/-0. Production code, tests and support each +0/-0. Exclude the other four topics, new pages/link mechanisms/wrapper APIs, business behavior, automatic recovery/race detail and CLAUDE.md edits.

## Driver handoff

No build permission or owner approval is claimed. The driver checks and commits this plan, obtains one Claude read, addresses findings, then requests watcher `PLAN FOR APPROVAL`; docs-only publication also waits for clearance. Ask first: **Is this the simplest scoped result, and what does it build that the request did not name?** Then: **Is it correct and buildable?**
