# Boot the development recipe

Use this rehearsal to build a Debian 13 amd64 root and open Waitron’s setup screen in
QEMU. The check requires the recipe’s USB origin in setup status, checks that Demo
is absent and Prepare, Live and Join or recover are offered, then opens Prepare’s
administrator form. It does not complete setup.
CI runs the pure evidence/parser tests, but does not rebuild or boot this recipe.

Run from the repository root on a Mac with Docker Desktop. Allow about 8 GiB of
container memory and several GiB of disk space. All guest disks and Docker data stay
inside a disposable tool container. Use new names and empty output directories for
each run. Build the app from a clean, signed commit that includes the installation-origin
consumer; the older published app used by the initial rehearsal does not include it.
Keep the commit and image metadata with your results.

```sh
inputs=$(mktemp -d)
test -z "$(git status --porcelain)" || { printf '%s\n' "Stop: commit or set aside your changes before building." >&2; exit 1; }
git rev-parse HEAD > "$inputs/source-commit.txt"
app="waitron-b3-app:$(git rev-parse --short HEAD)"
docker build --platform linux/amd64 --target runtime -f deploy/Dockerfile -t "$app" .
agent=ghcr.io/clintongormley/waitron-print-agent@sha256:650a9d69b217cb2f713cb6209539e3799f42bf4fb107d13f5d2798bb79ef37d9
docker pull --platform linux/amd64 "$agent"
docker pull --platform linux/amd64 axllent/mailpit:v1.33.0
docker tag "$agent" waitron-b3-agent:rehearsal
docker image inspect --platform linux/amd64 "$app" "$agent" axllent/mailpit:v1.33.0 > "$inputs/sources.json"
docker save --platform linux/amd64 -o "$inputs/app.tar" "$app"
docker save --platform linux/amd64 -o "$inputs/agent.tar" waitron-b3-agent:rehearsal
docker save --platform linux/amd64 -o "$inputs/mailpit.tar" axllent/mailpit:v1.33.0

docker build -f bench/box-installer/Containerfile -t waitron-b3-tools:rehearsal .
docker run -d --name waitron-b3-rehearsal --cpus 4 --memory 8g \
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined --tmpfs /run --tmpfs /tmp \
  waitron-b3-tools:rehearsal
git ls-files -co --exclude-standard -z | tar --null -T - -cf "$inputs/source.tar"
docker cp "$inputs/source.tar" waitron-b3-rehearsal:/work/source.tar
docker exec waitron-b3-rehearsal tar -xf /work/source.tar -C /source
docker cp "$inputs" waitron-b3-rehearsal:/inputs
docker exec -w /source waitron-b3-rehearsal pnpm install --frozen-lockfile
docker exec -w /source/apps/setup waitron-b3-rehearsal \
  pnpm exec playwright install --with-deps chromium
docker exec -w /source waitron-b3-rehearsal \
  bash deploy/box/build.sh /inputs /work/output
docker exec -w /source -e B3_RECIPE_IMAGE=/work/output/waitron-box-dev.img \
  waitron-b3-rehearsal node bench/box-installer/run.mjs \
  --case recipe-setup --run-dir /work/check
mkdir "$inputs/results"
docker cp waitron-b3-rehearsal:/work/output/inventory.json "$inputs/results/"
docker cp waitron-b3-rehearsal:/work/output/packages.txt "$inputs/results/"
docker cp waitron-b3-rehearsal:/work/output/SHA256SUMS "$inputs/results/"
docker cp waitron-b3-rehearsal:/work/check/. "$inputs/results/"
```

Stop on a failed command and read its output before continuing. Keep `sources.json`,
which records image digests and source labels, alongside the results. The recipe
pins mkosi and guest Docker versions; `packages.txt` records the Debian package
versions actually selected. It is not a byte-for-byte reproducible build.

The output contains `waitron-box-dev.img`, its kernel/initrd, root UUID and image
inventory, plus the GPT firmware image `waitron-install-dev.img`. The networkless loading boot checks each archive’s configuration hash
against `docker save` inside the guest. Docker and containerd data are embedded in
the ext4 root. The acceptance boot uses QEMU’s temporary writes, checks that the
base image hash stays unchanged, verifies the mounted UUID, embedded images and
three running services, and renders setup over a loopback-only port forward. Guest
outbound networking is restricted. Screenshots, serial output (including the last 100 Docker log lines per service), status,
a timing receipt and the CA
fingerprint are retained in the check directory. The throwaway browser ignores
certificate errors for rendering; this does not qualify certificate trust.

## Install onto a virtual disk

To rehearse installation and independent startup, use the same tool container and output:

```sh
docker exec -w /source -e B3_INSTALLER_IMAGE=/work/output/waitron-install-dev.img \
  waitron-b3-rehearsal node bench/box-installer/run.mjs \
  --case installed-refusals --run-dir /work/refusals
docker exec -w /source -e B3_INSTALLER_IMAGE=/work/output/waitron-install-dev.img \
  waitron-b3-rehearsal node bench/box-installer/run.mjs \
  --case installed-setup --run-dir /work/installed
docker exec waitron-b3-rehearsal sh -c 'cd /work/refusals && tar -cf /work/refusal-evidence.tar -- *.json *.log'
docker cp waitron-b3-rehearsal:/work/refusal-evidence.tar "$inputs/results/"
docker exec waitron-b3-rehearsal sh -c 'cd /work/installed && tar -cf /work/installed-evidence.tar -- *.json *.log *.png'
docker cp waitron-b3-rehearsal:/work/installed-evidence.tar "$inputs/results/"
```

The first case checks that an occupied virtual target stays byte-for-byte unchanged.
The second creates a blank 12 GiB virtual disk, firmware-boots the installer, installs,
then detaches the source image and boots the target twice. It checks setup choices,
opens Prepare, compares the installed images and services, and checks that the machine
identity and certificate authority survive the second boot. Serial logs and QEMU
arguments show each phase; screenshots and observed JSON sit beside them.
Copy the small evidence files you need, leaving target.img and firmware-variable copies
inside the disposable container.

The writer takes no device argument. It requires the rig’s machine name, exactly one
non-source disk, the target’s virtio serial, no mounts or holders and an all-zero disk.
It writes EFI and boot partitions, then unencrypted btrfs with separate root, images,
volumes, logs and host-state areas. The disk starts the shipped development service;
no kernel, initrd, boot arguments or app-start unit is injected on disk-only boots.
The installed payload contains no installer writer or installer unit.

Both routes are development rehearsals in QEMU with Secure Boot off. The original
`recipe-setup` still supplies a temporary startup unit and boots its kernel directly.
Neither rehearsal qualifies physical installation, TPM/Secure Boot, retained disk keys,
first-start sealing, kiosk or real box/stick/Android behavior. Encryption before go-live
remains required. Next come the encrypted layout, then key sealing and startup with the
retained key. Certificate errors are ignored only for rendering the setup screen.

After retaining the small results, remove your rehearsal resources. Do not remove
shared images, volumes or build caches. Export the image first with `docker cp`
if you need it; otherwise deleting this container also deletes the built image.

```sh
docker stop waitron-b3-rehearsal
docker rm waitron-b3-rehearsal
docker image rm waitron-b3-tools:rehearsal "$app" waitron-b3-agent:rehearsal
rm -rf "$inputs"
```
