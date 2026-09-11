# Wiring the print agent into the box install

**Status:** design approved 2026-09-10 (owner brainstorm). Closes the Track P item owed to Track H
— `deploy/backlog.md`: "the box's compose runs the print-agent container beside the server".

## 1. What this delivers

A box built from `main` runs the print agent beside the server, on by default, so a single-box venue
gets central printing with nothing typed. This closes the item `docs/backlog.md` (Track P) owes Track
H: "the box's compose runs the print-agent container beside the server with `WAITRON_SERVER_URL` set
to the server's service address, so the same-box agent joins with nothing typed". Three gaps stand
between `main` today and that outcome, and this design closes all three:

1. **No published image.** CI builds only `deploy/Dockerfile` (`ghcr.io/…/waitron`). The commented
   compose block points at `ghcr.io/…/waitron-print-agent:main`, which has never been built or pushed.
   `apps/print-agent/Dockerfile` copies a pre-built `dist/print-agent.js`, so — unlike the app image —
   it cannot be built from a git URL by `try-branch.sh`.
2. **The compose service is commented out** (`deploy/compose.yml`), so no agent runs.
3. **The agent cannot trust the box's certificate, and its device mount cannot survive a re-plug.**
   Both are only reachable once (1) and (2) exist; both are proven below, not reasoned about.

## 2. Owner decisions (2026-09-10, this brainstorm)

- **On by default.** Every box runs the agent; the single-box venue is the majority case. This commits
  the compose device shape to hot-plug safety (§5), because a box with no printer, and the CI smoke
  runner, must still start.
- **One image definition.** A second build target in `deploy/Dockerfile`, not a self-contained
  `apps/print-agent/Dockerfile` — one workspace install, one build cache. The standalone Dockerfile is
  deleted.
- **The agent fetches the box CA and pins it** (§4, approach A of the brainstorm). Not a mounted CA
  file (blocked by 0600/0700 ownership and the secret-bearing volume), not a loopback TLS-skip branch.
- **USB via a read-only whole-`/dev` mount + a device-class cgroup rule** (§5), the shape the receipts
  below single out.
- The agent image moves from `node:24-alpine` to `node:26-slim`, matching the app image (same Node
  major, Debian `apt` for `bluez`). Nothing in the agent depends on Alpine.

## 3. The image — a second target in `deploy/Dockerfile`

The existing multi-stage build gains one line in the `build` stage and one new runtime stage.

- **`build` stage:** add `pnpm --filter @waitron/print-agent-app build` to the build line (it emits
  `apps/print-agent/dist/print-agent.js` via esbuild, already the package's `build` script).
- **New stage `FROM node:26-slim AS print-agent`:**
  - `apt-get install -y --no-install-recommends bluez` — supplies `bluetoothctl`, which
    `apps/print-agent/src/bluetooth.ts` spawns and which `node:24-alpine` never carried (a latent gap
    in the standalone image: the Bluetooth pair button could not have worked as shipped).
  - `install -d -o node -g node /var/lib/waitron-print-agent` (the state dir, owned by the `node`
    user the process runs as).
  - `COPY --from=build --chown=node:node /src/apps/print-agent/dist/print-agent.js /app/`.
  - `ENV NODE_ENV=production WAITRON_STATE_DIR=/var/lib/waitron-print-agent WAITRON_SETUP_PORT=9110`
    (the old Dockerfile's env, unchanged).
  - `USER node`, `WORKDIR /app`, `CMD ["node","/app/print-agent.js"]`.
- **Stage order:** the app's `runtime` stage stays the LAST stage in the file, so a bare
  `docker build -f deploy/Dockerfile .` (and `pnpm build:image`) still produces the app image with no
  `--target`. The agent is built with `--target print-agent`.
- **Deleted:** `apps/print-agent/Dockerfile` and `apps/print-agent/.dockerignore`.
- **`package.json`:** add `build:image:print-agent` beside `build:image`
  (`docker build -f deploy/Dockerfile --target print-agent -t waitron-print-agent:dev .`).

## 4. Certificate trust in the agent (`apps/print-agent`)

The box serves HTTPS on a leaf signed by its own private CA (`CN=waitron-setup-ca`, receipt below).
The agent's `fetch` is Node's global `fetch` with no CA handling — verified: a grep for
`rejectUnauthorized` / `NODE_EXTRA_CA_CERTS` / `undici` / any CA option across `packages/print-agent`
and `apps/print-agent` returns nothing. So the commented default `WAITRON_SERVER_URL=https://127.0.0.1`
would fail every request with a certificate-verification error. The CA file the box holds is mode 0600
in a 0700 dir owned by uid 10001, in the volume that also holds the box's secrets, so mounting it is
not the path.

**The path already exists on the box:** the plain-HTTP landing listener serves the CA, unauthenticated,
at `GET http://<host>/ca.crt` (`apps/server/src/landing-app.ts`, `config.landingPort` default 80) —
precisely so a device can come to trust the box. The agent uses it.

- **New `apps/print-agent/src/server-ca.ts`.** Given the configured server URL:
  - If its protocol is `https:`, derive the CA URL as `http://<hostname>[:80]/ca.crt` and GET it.
    On success, write the PEM to `<state-dir>/server-ca.crt` (atomic, mode 0644 — it is a public
    certificate, not a secret) and hold it in memory.
  - Build the agent's `fetch` from an `undici` `Agent` whose `connect.ca` is
    `[...tls.rootCertificates, boxCaPem]` — **Node's bundled public roots PLUS the pinned box CA**, so
    an agent that later follows a promoted cloud primary presenting a normal public certificate still
    verifies. The wrapper sets that `Agent` as the per-request `dispatcher`; when no box CA is held it
    passes no dispatcher and behaves as today. `undici` becomes an explicit dependency of
    `apps/print-agent` (Node 26 bundles it as the global `fetch` engine; the import makes `Agent`
    available).
  - **Bootstrap order:** at start, load `<state-dir>/server-ca.crt` if it exists (so a restart trusts
    immediately, before the landing listener is even reachable), then attempt one refresh.
  - **Rotation (a reimaged box mints a new CA):** when a request fails with a certificate-verification
    error (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` and kin), refetch `/ca.crt`
    at most once per hour; if the bytes changed, rebuild the dispatcher and log `server CA changed`.
  - If `/ca.crt` is absent (an operator-supplied server certificate, or a plain-`http:` URL) it runs on
    the system store, as today.
- **`bin.ts`** builds the trusting `fetch` via `server-ca.ts` and passes it to `createContainerHost`
  through the existing injected `fetch` seam. Nothing in `packages/print-agent` changes — the seam is
  already there (`ContainerHostOptions.fetch`, `createClient({ fetch })`).

The same-box case (loopback) is as trustworthy as the box itself. A separate-Pi case is
trust-on-first-use — the identical bargain the phone makes at the landing page.

## 5. The compose service — on by default

A `print-agent` service joins `app` / `db` / `mailpit`:

```yaml
print-agent:
  image: ${WAITRON_PRINT_AGENT_IMAGE:-ghcr.io/clintongormley/waitron-print-agent:main}
  restart: unless-stopped
  network_mode: host                      # mDNS discovery on the LAN; the setup page binds 9110 directly
                                          # (2026-09-11: the port-9100 sweep needs it too — see compose.yml)
  depends_on:
    app:
      condition: service_started          # not service_healthy: /health is 503 on a setup box
  environment:
    WAITRON_SERVER_URL: ${WAITRON_PRINT_AGENT_SERVER_URL:-https://127.0.0.1}
  device_cgroup_rules:
    - "c 180:* rwm"                       # the usblp char-device major; lets any /dev/usb/lpN through
  group_add:
    - "7"                                 # gid lp — owns the write bit on /dev/usb/lpN
  volumes:
    - print_agent:/var/lib/waitron-print-agent
    - /dev:/dev:ro                        # whole /dev, read-only — see the receipt below
    - type: bind
      source: /run/dbus/system_bus_socket
      target: /run/dbus/system_bus_socket
      bind:
        create_host_path: false           # fail loudly on a host with no DBus, don't fake the socket
  healthcheck:
    test: ["CMD","node","-e","const h=require('node:http');h.get({host:'127.0.0.1',port:9110,path:'/status.json'},s=>process.exit(s.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
    interval: 10s
    timeout: 5s
    start_period: 20s
    retries: 3
  logging:
    driver: json-file
    options: { max-size: 10m, max-file: "5" }
```

and a `print_agent:` entry in the `volumes:` block.

**Why `/dev:/dev:ro` and not `devices: ["/dev/usb/lp0"]` or `-v /dev/usb:/dev/usb`** — measured on the
real box 2026-09-10, printer present at start, then unplugged and re-plugged while three probe
containers ran:

- A hard `devices: /dev/usb/lp0` line makes Docker **refuse to create the container** when the device
  path is absent — a box with no printer, and the CI smoke runner, would never start. Rejected by the
  default-on decision.
- `-v /dev/usb:/dev/usb`: the `node` user saw and wrote `lp0` while it was plugged in at start, but
  after unplug/re-plug the container's `/dev/usb/lp0` was **gone and did not come back**
  (`cannot create /dev/usb/lp0: Directory nonexistent`). A subdirectory bind mount does not track a
  device node the kernel recreates in a parent that was, briefly, empty.
- `-v /dev:/dev:ro` + `device_cgroup_rules c 180:* rwm` + `group_add 7`: after the same
  unplug/re-plug, `/dev/usb/lp0` **reappeared** in the container and the unprivileged `node` user
  (`groups=…,7(lp)`) wrote ESC/POS to it and a slip printed. `:ro` still permits opening a
  character-device node for write (the read-only flag governs the filesystem, not the device I/O), and
  it earns two safety properties, both confirmed: `mknod` inside the container is refused
  (`Read-only file system`), and a device class the cgroup rule does not name is denied (an uncovered
  `/dev/hidraw0` read → denied). So the container can reach printer nodes and nothing else, and cannot
  fabricate device nodes.

`.env.example` documents `WAITRON_PRINT_AGENT_IMAGE` and `WAITRON_PRINT_AGENT_SERVER_URL`.
`deploy/README.md`'s "a node is N containers" sentence and the volumes table gain the agent and the
`print_agent` volume; the agent's own state (its token + saved config + the pinned `server-ca.crt`)
lives there, so `docker volume` is still the whole of a box's life.

## 6. CI

- **`image-smoke.yml`** (the reusable build+smoke, run on `main` and on any `deploy/` PR):
  - Build a second time with `--target print-agent`, tag `waitron-print-agent:ci`; set
    `WAITRON_PRINT_AGENT_IMAGE=waitron-print-agent:ci` in the written `.env`. The stage reuses the
    cached `build` layer, so it costs seconds.
  - `docker compose up -d --wait` now brings the agent up too. One new assertion, the only thing that
    proves the wiring end to end on a real Linux host: `curl -s http://127.0.0.1:9110/status.json`
    returns 200 and its `serverUrl` is `https://127.0.0.1` (the compose default reached the process).
    The smoke box has no printer, which is the point — the container must be `running`/healthy anyway,
    which the read-only `/dev` mount (no hard `devices:` line) is what allows.
  - The "refuse to smoke against something already listening" guard adds port `9110` to its list.
- **`ci.yml` `publish` job:** a second `docker/build-push-action` step, `target: print-agent`, tags
  `ghcr.io/…/waitron-print-agent:{sha-<7>,main[,<version>]}` built from the same `steps.tags` logic
  (a shared helper computes both repos' tag lists from one ref parse). Same `platforms:
  linux/amd64,linux/arm64`, same cache scope.
- **`try-branch.sh`:** build both targets from the git context and set both `WAITRON_IMAGE` and
  `WAITRON_PRINT_AGENT_IMAGE` inline on the `compose up`, so a branch's agent is testable on a box the
  same way the app is.

## 7. Testing

TDD, failing test first, per piece:

- **`apps/print-agent/src/server-ca.test.ts`** — the core new logic, against a throwaway in-process CA
  and HTTPS server (the shape in `apps/server/src/testing/tls.ts`) plus a plain-HTTP `/ca.crt` responder:
  1. Without the pinned CA, a `fetch` to the HTTPS server fails certificate verification (negative
     control — the bug this fixes).
  2. After fetching `/ca.crt` and building the dispatcher, the same `fetch` succeeds.
  3. A server presenting a certificate from a **public** root still verifies (system roots retained) —
     proves the promoted-cloud-primary case is not broken.
  4. Rotation: the CA bytes change, a verification failure triggers one refetch, and a subsequent
     request succeeds; the once-per-hour throttle holds.
  5. `http:` URL / absent `/ca.crt` → no dispatcher, system store, no throw.
- **Root guard `scripts/deploy-image-env.test.ts`** gains pins (it reads text; these are pins between
  copies of one fact, per its header):
  - The compose `print-agent` image default equals the repo `publish` tags
    (`ghcr.io/…/waitron-print-agent`).
  - The `image-smoke` workflow builds `--target print-agent` and the compose service runs that image.
  - The agent stage's `WAITRON_STATE_DIR` ENV equals the `print_agent` volume's container mount path.
  - The USB mount is `/dev:/dev:ro` and the device rule names major `180` — so a "simplification" back
    to a subdirectory mount or a hard `devices:` line fails here, with this spec's §5 receipt as the
    reason.
  - `apps/print-agent/Dockerfile` no longer exists (the standalone image is not resurrected).
- **`scripts/ci-workflow.test.mjs`** gains: the `publish` job builds both targets; the second is gated
  by the same `needs.ci.result == 'success'` as the first (no unguarded publish path).
- **The image smoke on the PR** exercises the whole compose bring-up (the branch touches `deploy/`, so
  the `image` job runs on the PR, not only on `main`).

## 8. Live verification (the plan's final task, on `clinton@waitron.local`)

Not a claim to reason about — the box is reachable over SSH with `sudo -n docker`:

1. `docker compose pull && docker compose up -d` on the box (once the image is published).
2. `docker compose ps` shows `waitron-print-agent-1` healthy; `ss -ltn` shows `:9110`.
3. `curl -s http://127.0.0.1:9110/status.json` → phase `pending`, `serverUrl https://127.0.0.1`, a
   verification code (proves the CA pin worked — a failed pin would leave it `unreachable`).
4. In the dashboard the agent appears under "print agents waiting to join" with that code; Accept.
5. Within one poll the agent is `running`; assign the USB printer and print a test slip.

## 9. Scope

**In scope:** the second image target (§3), the CA-pinning module + `bin.ts` wiring (§4), the compose
service (§5), CI publish + smoke + `try-branch` (§6), the tests (§7), the docs and backlog updates,
the live check (§8).

**Out of scope:** any change to `packages/print-agent` (the `fetch` seam already exists); the agent's
behaviour on a separate Pi beyond documenting the trust-on-first-use bargain; Bluetooth beyond
shipping `bluez` and the DBus socket mount (the box has no adapter — receipt §10 — so the live radio
stays fixture-tested, as the central-printer spec already recorded).

**Open questions:** none blocking.

## 10. Provenance

Designed 2026-09-10 against the live tree, the landed #289/#304 print agent, and receipts taken on the
real box the same evening.

**Internal (file:line):** the commented compose block this replaces — `deploy/compose.yml:145-178`;
the app image build + publish it mirrors — `deploy/Dockerfile`, `.github/workflows/ci.yml:1480-1540`
(`publish`), `.github/workflows/image-smoke.yml`; the standalone image being deleted —
`apps/print-agent/Dockerfile`; the injected `fetch` seam the CA pin uses —
`apps/print-agent/src/host.ts:26,78`, `apps/print-agent/src/bin.ts:14-22`,
`packages/print-agent/src/client.ts:248-254`; the unauthenticated CA route the agent fetches —
`apps/server/src/landing-app.ts` (`/ca.crt`), `apps/server/src/config.ts:246-249` (landing port 80);
the leaf-SAN / self-signed CA shape — `apps/server/src/box-secrets.ts`, `apps/server/src/boot.ts:289`
(`BOX_HOSTNAME`); the env pin guard extended here — `scripts/deploy-image-env.test.ts`; the config
parser that already refuses `""` and non-http URLs — `apps/print-agent/src/config.ts`; the in-process
TLS test shape — `apps/server/src/testing/tls.ts`.

**Receipts (real box `clinton@waitron.local`, 2026-09-10, Docker 29.8.0, kernel 7.0.0):**

- USB printer binds `usblp` as `/dev/usb/lp0` (`crw-rw---- root:lp`, major:minor `180:0`),
  serial `B120300001` — matches the central-printer receipt.
- Device-node reachability across a hot-plug, three probe containers: hard `devices:` refuses to
  create with no printer (rejected); `-v /dev/usb:/dev/usb` went stale on re-plug (`Directory
  nonexistent`); `-v /dev:/dev:ro` + `device_cgroup_rules c 180:* rwm` + `group_add 7` reappeared and
  the `node` user (uid 1000, `7(lp)`) wrote ESC/POS and a slip printed. `:ro` refused `mknod`; an
  uncovered device class (`/dev/hidraw0`) was denied. Probe containers removed.
- The box's landing listener answered `GET http://127.0.0.1/ca.crt` → 200, `CN=waitron-setup-ca`; the
  leaf's SANs are `waitron.local, localhost, 127.0.0.1, 192.168.10.10`; the leaf verifies against that
  CA (`Verify return code: 0`), and `https://127.0.0.1/print-api/agent/join/status` answered 200 with
  the CA supplied — the exact call the agent makes.
- No Bluetooth adapter on the box (`/sys/class/bluetooth` absent); the DBus socket is present
  (`/run/dbus/system_bus_socket`). `bluez` ships; the live radio stays deferred.

**External (to verify, not asserted, per CLAUDE.md §1):** that `-v /dev:/dev:ro` tracks a hot-plugged
device node — verified above on this box/kernel/Docker, to be re-confirmed if the box image's base OS
changes; that undici's per-request `dispatcher` with `connect.ca` overrides the global store as
intended — proven by `server-ca.test.ts` case 3 (public root still verifies).
