# A1315: device profile guide plan

Request: “Help bubbles orient — missing guides”; lane D queue A1315 and `docs/backlog/dashboard.md#a1315-bring-every-help-bubble-down-to-orientation-one-area-per-pr`. Preserve A1247’s wrapper exclusion.

Finish line: staff can read how to switch this device's profile on the existing Table service guide page, EN/ES, with shared heading id `{#device-profile}`. The Profile bubble still has no guide link (A1247), and its two sentences stay unchanged. This is lane D's scoped slice.

## Sources read before wording

Readings, not runtime verification: the app offers profiles, refuses an unsent order, attempts draft saving and requests a switch; the server checks approval, admission and payments.

| Receipt | What this plan reuses |
| --- | --- |
| `apps/till/src/widgets/till-shell.ts:1008-1014,1070-1072,1193-1239,1275-1277` | Profile is in More: above Settings on a handheld, alongside it on a till. |
| `apps/till/src/widgets/profile-dialog.ts:99-134`; `apps/till/src/i18n/strings.ts:323,853-857,2305,2813-2817` | Chooser, action and existing EN/ES labels. |
| `apps/till/src/till-app.ts:10453-10545`; `apps/server/src/device-api.ts:489-503`; `apps/server/src/device.ts:248-258,294-331` | Switch call chain: park/clear first; approved and admitted profile; payment stop. `till-app.ts:21730` gates Profile on more than one approval. |
| `apps/server/src/guide/en/table-service.md:470-496`; `apps/server/src/guide/es/table-service.md:498-526` | Existing `{#device-zones}` section already explains profile-local saved zones; link without repeating it. |
| `packages/ui/src/components/wt-menu-row.ts:33-46`; `docs/backlog/dashboard.md:527-528`; `apps/server/src/guide-pages.ts:187-190` | A1247 keeps table/tabs/menu-row APIs unchanged. Read this section on the existing Table service guide page; no menu-row link is added. |

## One documentation task, after clearance

- [ ] Add the following section immediately before `{#device-zones}` in the two existing guides. **Before, EN/ES:** no device-profile section. **After, EN:**

```markdown
## Switch this device's profile {#device-profile}

When this device is approved for more than one profile, **More** (☰) offers **Profile**.
Choose another **Device profile** and tap **Switch**. You can only switch to a profile you are
allowed to use.

Before switching, park or clear the order in progress and wait for any payment in progress to finish.
To choose which zones this device shows, see
[Choose the zones this device shows](table-service.md#device-zones).
```

**After, ES:**

```markdown
## Cambiar el perfil de este dispositivo {#device-profile}

Cuando este dispositivo está aprobado para más de un perfil, **Más** (☰) ofrece **Perfil**.
Elige otro **Perfil de dispositivo** y toca **Cambiar**. Solo puedes cambiar a un perfil que
tengas permiso para usar.

Antes de cambiar, aparca o vacía el pedido en curso y espera a que termine cualquier cobro en curso.
Para elegir qué zonas muestra este dispositivo, consulta
[Elegir las zonas que muestra este dispositivo](table-service.md#device-zones).
```

Bubble before = after (`apps/till/src/i18n/help-strings.ts:37-38,100-101`): EN "Switches this device to another profile it is approved for. Park or clear the order in progress first." ES "Cambia este dispositivo a otro perfil para el que está aprobado. Antes, aparca o vacía el pedido en curso."

- [ ] When built, remove only device profile from A1315’s missing destinations in `docs/backlog.md` and `docs/backlog/dashboard.md`. Keep equipment, department transfers, Fix my hours and zone Reset, the shared heading anchor, root links and A1247 Decisions. Do not edit the backlog while publishing this plan.
- [ ] Run from root: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` (rendering, links, EN/ES section order) and `pnpm exec vitest run scripts/guide-links.test.ts` (existing app destinations/writers). Require passing test counts. Neither checks wording accuracy. Changed assertions: none. No new tests, prose pins, harness or TDD: documentation only.
- [ ] Run `git diff --check` and `pnpm exec prettier --check apps/server/src/guide/en/table-service.md apps/server/src/guide/es/table-service.md`. Check copy against receipts, relative zones links, both anchors and the four remaining backlog topics. Include EN/ES before/after and receipts in the change description.

Expected lines: guides +10/-0 each; root backlog +3/-3; detailed backlog +2/-2; this plan +59/-0. Production code, tests and support each +0/-0. Exclude the other four topics, new pages/link mechanisms/wrapper APIs, business behavior, automatic recovery/race detail and CLAUDE.md edits.

## Watcher decisions before build

Claude read157s; the driver applied its single-profile, payment, navigation and receipt corrections. Recommend one additional sentence in the guide: EN “Other staff signed in on this device are signed out if the new profile does not allow them to sign in.” ES «Las otras personas que tengan sesión en este dispositivo salen de ella si el nuevo perfil no les permite iniciar sesión.» Source read: `apps/server/src/device.ts:263-284,325`. This visible consequence is pending watcher clearance, not an automatic recovery detail. Also ask whether the other three menu-row topics should use guide-only sections while A1247 excludes wrapper links; each still gets its own source-informed plan. No such extra section is authorised here.

## Driver handoff

No build permission or owner approval is claimed. After this single Claude read and corrections, request watcher clearance before building or publishing the plan.
