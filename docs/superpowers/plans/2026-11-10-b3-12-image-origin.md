# B3-12 PR B: consume installation origin from the recipe

**Approved by the watcher, 2026-11-10 08:12 CET (Lane K `questions.md`).** Lane K `questions.md`, watcher 2026-11-10 05:52: “PR B: the setting that hides Demo, consumed from that image.” The 07:54 note permits this plan during [PR A #2712](https://github.com/clintongormley/waitron/pull/2712)’s CI wait; build depends on A landing. Refresh against main first. [Design §§12.1/12.5](../specs/2026-10-21-b3-usb-installer-design.md) remains historical.

**Change.** Have the recipe write `WAITRON_INSTALLATION_ORIGIN=usb` into `/opt/waitron/.env`; compose passes it to the app. Missing/empty means hand-installed; reject other values. Add optional `installationOrigin: "usb"` to `ServerConfig`, `SetupDeps` and status/client shapes. Carry it through both app status reads and both mode mounts; absence clears it. Split Demo from Prepare rendering. USB preproduction offers Prepare, Live and Join or recover; hand-installed choices remain. Production still hides/refuses Demo and Prepare, taking precedence over origin. Keep existing `trading.env` production handling; add no second production record or first-claim gate.

After provision parsing, retain production’s check first, then refuse USB Demo before provisioning/seeding, including supplied operations. Extend `setup.mode_not_allowed` with `{ installationOrigin: "usb" }`, retaining HTTP 400 and production’s `{ environment: "production" }`. Browser-supplied origin never changes server origin. Leave fiscal/golden tests untouched.

Select refusal wording by error params; preserve production/fiscal messages and Reload without Retry. EN: “Demo is unavailable on this box. Reload to return to setup, then choose Prepare your restaurant, Live or Join or recover.” ES: “Demostración no está disponible en este servidor. Recarga para volver a la configuración y elige Prepara tu restaurante, En vivo o Unirse o recuperar.”

**Exact files.** Modify these existing paths, plus this new plan.

| Directory | Files |
| --- | --- |
| `deploy/` | `compose.yml`, `box/build.sh`, `README.md` |
| `apps/server/src/` | `config.ts`, `boot.ts`, `setup-api.ts`, `errors.ts`, `config.test.ts`, `boot.setup-routes.test.ts`, `setup-api.throwaway.test.ts` |
| `apps/setup/src/` | `api/client.ts`, `setup-app.ts`, `screens/mode-screen.ts`, `i18n/strings/shell.ts`, `setup-app.test.ts`, `screens/mode-screen.test.ts` |
| `scripts/` | `deploy-image-env.test.ts`, `box/recipe-setup.mjs`, `box/recipe-setup.test.mjs` |
| `bench/box-installer/` | `run.mjs`, `README.md` |
| `docs/` | `backlog.md`, `backlog/box.md`, `developers/workflow-guide.md`, `superpowers/plans/2026-10-26-b3-usb-installer.md`, `superpowers/plans/2026-11-10-b3-12-image-origin.md` |

Forecast, added/removed lines separately: production/configuration **110/15**, tests **220/10**, support **35/0**, documentation **70/10**; **470 changed lines across 26 paths**. No committed outputs/screenshots.

**Test ownership.** Config owns absent/empty/usb/invalid parsing; deploy-image-env pins compose passthrough. One boot case owns process-origin/status wiring. Route tests own Demo’s exact refusal/no provision/no seed, supplied-operations checks, USB Prepare/Live admission and production precedence; reuse existing fixtures/assertions. App tests own propagation, clearing and localized remedies; screen tests own choices/navigation and the new Prepare/Live group styling. Retain existing accessibility cases. Recipe tests add only origin acceptance/rejection, retaining existing checks. `deploy/box/build.sh` writes the key; the pure recipe checker requires it and the runner inspects choices. No `box-env.test.ts`, generic env/type tests, repeated failure matrices or unrelated guide/LAN/key work.

**Image acceptance and finish line.** A embeds published source `5ed6b4dc`, so replace its app input. Choose a unique `candidate_tag`. Commit with sign-off, require a clean tree, then use outer Docker Desktop `docker build --platform linux/amd64 --target runtime -f deploy/Dockerfile -t "$candidate_tag" .` from that commit. Save that tag as `app.tar`; copy it into A’s private Linux tooling container alongside agent/mailpit archives. Record commit SHA, architecture and image configuration hash. Any later app/recipe change invalidates acceptance and requires a fresh rebuild/check. No socket sharing, publication assumption or Dockerfile/CI change. Use fresh output directories and remove only owned resources.

Run `bash deploy/box/build.sh /inputs /work/output`, then `B3_RECIPE_IMAGE=/work/output/waitron-box-dev.img node bench/box-installer/run.mjs --case recipe-setup --run-dir /work/check`. Extend this one acceptance case: recipe-shipped flag reaches status as `usb`; actual choices contain no Demo, retain Live/existing, and Prepare opens its administrator form. Retain hashes, logs and screenshots. No hand-set flag substitutes for integration.

**Budget: three hours to open PR.** Minutes 0–25 measure the fresh amd64 app build; feasibility/time are unmeasured. Failure or duration over 20 minutes returns to watcher at minute 25. `COPY . .` precedes install/build in the Dockerfile, so budget the rebuild at the measured trial duration. Minutes 25–90: failing behavioral tests, minimal implementation, passing tests. 90–135: rebuild candidate and run recipe acceptance. 135–180: changed-file checks, EN/ES/light/dark/phone inspection, one Claude run-it review, signed commits, normal hook and PR. Run root’s two listed test files with `pnpm exec vitest run`; run each package’s listed files with `pnpm --filter @waitron/server exec vitest run` or `pnpm --filter @waitron/setup exec vitest run`. Read test counts; require current-head CI. Update backlogs, workflow’s production-only refusal description and a dated parent-plan pointer. Only compose documents recipe ownership; leave `.env.example` alone.

**Remaining:** first-start sealing/restart, encrypted host-state and Linux adapters, release VM qualification, same-box production re-setup restrictions and disk-key delivery remain open. Physical USB/box boot, firmware/TPM, power cuts and TLS/Android trust need later qualification.
