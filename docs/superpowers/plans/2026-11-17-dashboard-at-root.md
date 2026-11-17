# Dashboard at root — implementation plan

**Finish line:** Lane I’s DASHBOARD-AT-ROOT request quotes the owner: “Move the dashboard to / now”. Dashboard uses `/`, `/account`, etc.; till uses `/till/` and `/till/tabs/<key>`. APIs, setup, handover, help and legal keep their paths. Separate Sol/high draft, two Claude reads; corrections incorporated. Watcher clearance remains pending; no owner design approval is claimed.

**Size/staging decision:** recommend one atomic PR, separating mechanical substitutions in a recorded commit. Estimate ~300 files: production/config 250–450 changed lines, mechanical tests/fixtures 1,800–2,800, focused tests 150–250. Generated duration metadata changes only if test titles change. This exceeds medium. Claude’s smaller alternative moves till and serves dashboard HTML at exactly `/`, keeping `/manage/` links until a second PR; that delivers the landing page but postpones the full move. Watcher settles staging/size before build.

**Reuse/boundaries:** retain `mountSpa`, `UrlStateController`, `captureAppLinks`, `devCrossAppLinks`. One browser-safe shared `app-surfaces.ts`/index export holds reserved prefixes and `isDashboardPath` for fallback, link capture and permission/recovery returns. This classifies pages, never authorises APIs. Repair/spare admission accepts dashboard **or till** pages. Preserve dotted/missing-file 404s, including `/sw-probe.js`.

**Remote/waits:** retain staff method/API allowlists, machine refusals and throttle. Serve dashboard GET/HEAD directly with `mountSpa`; never delegate arbitrary root GETs. Reuse main’s spare-read and zone-repair gates in their existing order with identical boot inputs before staff pages; APIs keep main delegation/gates. Named server/till routes precede dashboard fallback. Peer-wait serves both apps’ page GETs and probes the current path. Clock-wait returns by GET to its safe path/query. Carry-on transports that destination in a hidden field, validates a local dashboard/till page, and preserves it through errors/success/back links; never replay POSTs.

**Enrolled tills:** no compatibility redirect. Cookies have `Path=/` (`device-session.ts:76`); saved addresses reduce to origins (`server-router.ts:405`). Replace old bookmarks/home-screen launches with `/till/`. Move manifest start/scope/link and dev handler, keep shared icons. The only found worker registration is the missing-script trust probe, not an offline worker.

**Files and owning checks** (S=server/src, D=dashboard/src, T=till/src, P=ui/src):

| Files / group | Behavior tests |
| --- | --- |
| shared app-surfaces/index; S spa-api/boot/config/cloud-remote/zone-repair-serving/spare-read-gate | Classifier boundaries/escape inputs; SPA cache/assets; remote nondelegation, mirror/repair gates and boot mounts. |
| D navigation/dashboard-app/nav-destinations/permission-continuation and dashboard/module screens; P app-links | Deep refresh, Back/Forward, links, unsaved drafts, safe returns; preserve assertions during URL substitutions. |
| T navigation/till-app/till-device-chooser/profile-dialog/recovery-refusal/till-enrol-screen; fiscal conflict-evidence | Till/tab paths, both chooser exits, recovery/approval links. |
| S account-mail/management-api/handover-page-mount/handover-emergency-api/waiting-page/waiting-start/start-clock-waiting/carry-on; setup done/handover and boot join wiring | Account/Google targets, pairing QR, waiting probes/returns and POST destination validation. |
| Three Vite configs; dev-server-proxy; T manifest/index.html | Bases, default/shifted-port links, proxy, manifest and brand tests. |
| deploy/waitron.sh; server/scripts/dev-setup; current READMEs/guides; S guide EN/ES box-status; backlog dev-URL entry | Printed URLs, script companions, guide links/content. Historical plans get dated pointers. |

**Cloud coordination:** Lane G’s 17:11 source comparison finds no relay path rewrite; no live forwarding claim. Watcher assigns G’s `registration/src/relay-smtp.ts:17` invitation/reset change to `/account`: prepare alongside, deploy Waitron boxes first, then Cloud; qualify destinations and resend emails spanning the pre-live deployment gap. Email-change `/` stays. Watcher must accept/order this gap and afterwards update external `wa-wt` addresses. No Cloud/shared-tool edits here.

**Validation/exclusions:** TDD by owning layer, changed suites, normal hook/current-head CI. Build all apps; LOOK in both themes at phone/desktop widths, refresh deep links, check assets/manifest and existing/fresh enrolment. No redirects, storage migrations, auth redesign, route framework, offline support or unrelated cleanup.
