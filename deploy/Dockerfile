# The Waitron node's app image. Built from the repository root:
#   docker build -f deploy/Dockerfile -t waitron:dev .   (`pnpm build:image`)

ARG WAITRON_BUILD_ID=development

# ---------------------------------------------------------------------------
# Build stage — install the workspace and run the builds that already exist.
# ---------------------------------------------------------------------------
FROM node:26 AS build

# pnpm is installed by npm rather than corepack: corepack is no longer shipped in the node image
# (measured on node:26 — `corepack: not found`). The version is the root package.json's
# `packageManager` field; the two must stay equal or the lockfile check below is meaningless.
RUN npm install --global pnpm@9.15.0

# The root `prepare` script installs git hooks, which a build context without .git cannot do and an
# image has no use for.
ENV HUSKY=0

WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile

# `@waitron/server`'s build emits dist/server.js, dist/node-entry.js (this image's ENTRYPOINT), the
# four operator CLIs and dist/drizzle/ (copy-migrations.mjs); the three web apps emit dist/ via vite.
RUN pnpm --filter @waitron/server build \
  && pnpm --filter @waitron/till build \
  && pnpm --filter @waitron/dashboard build \
  && pnpm --filter @waitron/setup build \
  && pnpm --filter @waitron/print-agent-app build

# sharp stays out of every server bundle (`--external:sharp`): its native addon and the libvips
# library the addon loads cannot be bundled. This gathers sharp and what it loads at run time into
# one plain directory, following pnpm's links, for the runtime stage to put beside the bundle. pnpm
# also installs the musl builds; node:26-slim is glibc, so they are dropped. The last line fails the
# build when no linux glibc build of the addon or of libvips was gathered, for any architecture;
# image-smoke's sharp step is what loads sharp in the built image.
RUN set -eux; \
  [ "$(ls -d /src/node_modules/.pnpm/sharp@* | wc -l)" -eq 1 ]; \
  mkdir -p /sharp-runtime/node_modules; \
  cp -rL /src/node_modules/.pnpm/sharp@*/node_modules/. /sharp-runtime/node_modules/; \
  rm -rf /sharp-runtime/node_modules/@img/*linuxmusl*; \
  ls /sharp-runtime/node_modules/@img/sharp-linux-*/lib/*.node \
    /sharp-runtime/node_modules/@img/sharp-libvips-linux-*/lib/libvips-cpp.so.*

# libvips (LGPL-3.0-or-later) is loaded by sharp as its own shared library from
# @img/sharp-libvips-linux-<arch>. That package's README is the notices list for every library
# built into the file, and versions.json names each version; both ship in /app/third-party with
# the licence texts and the written source offer (deploy/third-party/README.md).
RUN set -eux; \
  set -- /sharp-runtime/node_modules/@img/sharp-libvips-linux-*; \
  [ "$#" -eq 1 ]; \
  [ -d "$1" ]; \
  mkdir -p /third-party/libvips; \
  cp "$1/README.md" /third-party/libvips/NOTICES.md; \
  cp "$1/versions.json" /third-party/libvips/versions.json

# ---------------------------------------------------------------------------
# Print-agent stage — the box-local bridge to USB/network/Bluetooth printers.
# A SEPARATE image from the app (its own compose service), built with
# `--target print-agent`. bluez supplies bluetoothctl, which the Bluetooth
# pair path spawns; node:24-alpine never carried it. Runs as the unprivileged
# `node` user the base image already ships (uid 1000).
# ---------------------------------------------------------------------------
FROM node:26-slim AS print-agent
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends bluez; \
  rm -rf /var/lib/apt/lists/*
# The state volume's mount path, pre-created and chowned so a fresh named volume comes up writable by
# the non-root process (same rule as the app image's /var/lib/waitron paths).
RUN install -d -o node -g node /var/lib/waitron-print-agent
COPY --from=build --chown=node:node /src/apps/print-agent/dist/print-agent.js /app/print-agent.js
ENV NODE_ENV=production \
  WAITRON_STATE_DIR=/var/lib/waitron-print-agent \
  WAITRON_SETUP_PORT=9110
# Documentation only under network_mode: host (the port is not published via Docker) — kept from the
# standalone image so the setup port is visible in `docker inspect`.
EXPOSE 9110
USER node
WORKDIR /app
CMD ["node", "/app/print-agent.js"]

# ---------------------------------------------------------------------------
# Litestream stage — the pinned binary the server runs as a child process to
# stream venue.db to the owner's bucket (packages/stream). A stage of its own so
# its layer depends on nothing but this RUN and survives every source change
# the build stage's `COPY . .` sees. The sums are the release's own
# checksums.txt for the tag; scripts/litestream-pin.test.ts holds them and the
# version equal to scripts/setup-litestream.mjs and packages/stream. BuildKit
# sets TARGETARCH; the classic builder leaves it empty, which `*)` refuses.
# ---------------------------------------------------------------------------
FROM node:26 AS litestream
ARG TARGETARCH
RUN set -eux; \
  version=0.5.17; \
  case "${TARGETARCH}" in \
    amd64) asset="litestream-${version}-linux-x86_64.tar.gz"; sum="cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d" ;; \
    arm64) asset="litestream-${version}-linux-arm64.tar.gz"; sum="f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5" ;; \
    *) echo "no pinned litestream ${version} for '${TARGETARCH}'" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/litestream.tar.gz \
    "https://github.com/benbjohnson/litestream/releases/download/v${version}/${asset}"; \
  echo "${sum}  /tmp/litestream.tar.gz" | sha256sum -c -; \
  tar --no-same-owner -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream; \
  rm /tmp/litestream.tar.gz; \
  test "$(/usr/local/bin/litestream version)" = "${version}"

# ---------------------------------------------------------------------------
# Runtime stage — the build outputs and a non-root user.
# ---------------------------------------------------------------------------
FROM node:26-slim AS runtime

ARG WAITRON_BUILD_ID

# libcap2-bin is here for the setcap below.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates libcap2-bin; \
  rm -rf /var/lib/apt/lists/*

# The on-prem profile is `network_mode: host`, whose namespace keeps the kernel's
# ip_unprivileged_port_start=1024, so a non-root bind to 443 fails EACCES there — while Docker's own
# bridge namespace sets 0 and needs nothing. The capability makes both profiles work, and Docker's
# default capability set retains CAP_NET_BIND_SERVICE, so nothing is added at run time.
RUN setcap cap_net_bind_service=+ep /usr/local/bin/node

# The pinned Litestream (the `litestream` stage), on PATH, where the server's default
# WAITRON_LITESTREAM_BIN (`litestream`) finds it.
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

RUN groupadd --system --gid 10001 waitron \
  && useradd --system --uid 10001 --gid 10001 --home-dir /var/lib/waitron \
    --shell /usr/sbin/nologin waitron

# A fresh named volume INHERITS the ownership of the image path it is mounted over: a pre-created,
# chowned path comes up owned by the app and writable, while a path the image never created comes up
# root:root and the non-root process cannot write to it at all. Adding a volume to compose.yml
# without its line here is therefore a boot failure, not a warning.
RUN install -d -o waitron -g waitron -m 0700 /var/lib/waitron \
  && install -d -o waitron -g waitron -m 0700 \
    /var/lib/waitron/state \
    /var/lib/waitron/logs \
    /var/lib/waitron/backups

# Named file by file rather than copying the whole of dist/, because dist/ also holds the demo
# scripts (record-one-sale.js and friends) — and record-one-sale.js writes a real sale through the
# real Veri*Factu backend into an append-only, hash-chained table, under any WAITRON_ENV including
# production. A production image has no business carrying it. dist/package.json ({"type":"module"})
# travels with the bundle so /app declares its own module system rather than inheriting one from a
# walk up the filesystem. deploy-image-env.test.ts pins this list against package.json's
# `waitron.commands`.
COPY --from=build --chown=waitron:waitron \
  /src/apps/server/dist/server.js \
  /src/apps/server/dist/node-entry.js \
  /src/apps/server/dist/bin-restore.js \
  /src/apps/server/dist/bin-rejoin.js \
  /src/apps/server/dist/bin-break-glass.js \
  /src/apps/server/dist/bin-recovery.js \
  /src/apps/server/dist/package.json \
  /app/
COPY --from=build --chown=waitron:waitron /src/apps/server/dist/drizzle/ /app/drizzle/
COPY --from=build --chown=waitron:waitron /src/apps/till/dist/ /app/web/till/
COPY --from=build --chown=waitron:waitron /src/apps/dashboard/dist/ /app/web/dashboard/
COPY --from=build --chown=waitron:waitron /src/apps/setup/dist/ /app/web/setup/
COPY --from=build --chown=waitron:waitron /src/apps/server/scripts/demo-seed/media/ /app/demo-media/
COPY --from=build --chown=waitron:waitron /sharp-runtime/node_modules/ /app/node_modules/
COPY --from=build --chown=waitron:waitron /src/deploy/third-party/ /app/third-party/
COPY --from=build --chown=waitron:waitron /third-party/libvips/ /app/third-party/libvips/

# Fixed in the image, never operator-set: the server's own defaults for these sit beside the bundle,
# which is a read-only layer — every writable path is a volume. WAITRON_BACKUP_DIR is deliberately
# NOT here: a destination without WAITRON_BACKUP_RECOVERY_KEY is fail-closed (backup-config.ts's
# loadBackupConfig throws), so setting the path alone would take a provisioned box down at boot.
# There is no backup connection setting: the backup duty opens the box's own venue directory
# (backup-config.ts's header, and backup-supervisor.ts, which takes `venueDir` and calls the venue
# handle's own archiveTo). compose.yml passes the dir and the recovery key from the box's .env —
# those two backup values and no third.
#
# WAITRON_HTTP_HOST must be 0.0.0.0: config.ts defaults it to 127.0.0.1, which is right for a dev
# machine and wrong for every container — the phone is the screen, so a server bound to the
# container's own loopback is reachable by nothing. Measured on the first stack-up: with the
# default, the published port accepts the TCP connection (docker-proxy) and then resets the TLS
# handshake, while the in-container healthcheck passes — the two look nothing alike from outside.
#
# The two WAITRON_MANAGEMENT_* values are what a LIVE box needs to boot at all: the wizard's "live"
# writes WAITRON_ENV=production into trading.env, and config.ts then REQUIRES both (they only have
# dev defaults). Nothing else on a box sets them, so without these lines a restaurant that picks
# live gets server.config_missing on every boot until the entrypoint's counter reaches three and the
# box serves the recovery page instead — it never trades again without an operator.
#
# These are the ON-PREM default, not a fixed fact: they are right only for a box reached at
# waitron.local, so compose.yml passes both from the box's .env with these as the fallback (the
# image's ENV beats trading.env, box-env.ts, so .env is the only override an operator has). They are
# copies of boot.ts's BOX_HOSTNAME, pinned to it — along with compose's defaults and waitron.sh's
# QR URL — by scripts/deploy-image-env.test.ts, which is what makes a change to one of the four
# fail rather than ship a box whose certificate, QR and relying party disagree.
ENV WAITRON_STATE_DIR=/var/lib/waitron/state \
  WAITRON_BUILD_ID=${WAITRON_BUILD_ID} \
  WAITRON_LOG_DIR=/var/lib/waitron/logs \
  WAITRON_DEMO_MEDIA_SOURCE=/app/demo-media \
  WAITRON_MIGRATIONS_DIR=/app/drizzle \
  WAITRON_TILL_APP_DIR=/app/web/till \
  WAITRON_DASHBOARD_APP_DIR=/app/web/dashboard \
  WAITRON_SETUP_APP_DIR=/app/web/setup \
  WAITRON_HTTP_PORT=443 \
  WAITRON_HTTP_HOST=0.0.0.0 \
  WAITRON_MANAGEMENT_RP_ID=waitron.local \
  WAITRON_MANAGEMENT_ORIGIN=https://waitron.local \
  NODE_ENV=production

USER waitron
WORKDIR /app

# No CMD: the entrypoint takes no arguments, and the four operator CLIs are run by naming their file
# with --entrypoint (deploy/README.md). A bare `docker run <image> <command>` passes the command to
# node-entry.js as arguments, which it refuses with server.entry_arguments_refused.
ENTRYPOINT ["node", "/app/node-entry.js"]
