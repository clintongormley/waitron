# Boot the development recipe

Use this rehearsal to build a Debian 13 amd64 root and open Waitron’s setup screen in
QEMU. The check opens Prepare’s administrator form; it does not complete setup.
CI runs the pure evidence/parser tests, but does not rebuild or boot this recipe.

Run from the repository root on a Mac with Docker Desktop. Allow about 8 GiB of
container memory and several GiB of disk space. All guest disks and Docker data stay
inside a disposable tool container. Use new names and empty output directories for
each run. The commands below use the published images exercised on 2026-11-10;
the app’s source revision is `5ed6b4dc06100e54e38032e2fc8828ee423e59a5`.

```sh
inputs=$(mktemp -d)
app=ghcr.io/clintongormley/waitron@sha256:8d87eca08abc9d8cecd1a5ca6043cb9fc70aee8dc877d3edba76423d57f9bbeb
agent=ghcr.io/clintongormley/waitron-print-agent@sha256:650a9d69b217cb2f713cb6209539e3799f42bf4fb107d13f5d2798bb79ef37d9
docker pull --platform linux/amd64 "$app"
docker pull --platform linux/amd64 "$agent"
docker pull --platform linux/amd64 axllent/mailpit:v1.33.0
docker tag "$app" waitron-b3-app:rehearsal
docker tag "$agent" waitron-b3-agent:rehearsal
docker image inspect "$app" "$agent" axllent/mailpit:v1.33.0 > "$inputs/sources.json"
docker save -o "$inputs/app.tar" waitron-b3-app:rehearsal
docker save -o "$inputs/agent.tar" waitron-b3-agent:rehearsal
docker save -o "$inputs/mailpit.tar" axllent/mailpit:v1.33.0

docker build -f bench/box-installer/Containerfile -t waitron-b3-tools:rehearsal .
docker run -d --name waitron-b3-rehearsal --cpus 4 --memory 8g \
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined --tmpfs /run --tmpfs /tmp \
  waitron-b3-tools:rehearsal
git ls-files -co --exclude-standard -z | tar --null -T - -cf "$inputs/source.tar"
docker cp "$inputs/source.tar" waitron-b3-rehearsal:/tmp/source.tar
docker exec waitron-b3-rehearsal tar -xf /tmp/source.tar -C /source
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
inventory. The networkless loading boot checks each archive’s configuration hash
against `docker save` inside the guest. Docker and containerd data are embedded in
the ext4 root. The acceptance boot uses QEMU’s temporary writes, checks that the
base image hash stays unchanged, verifies the mounted UUID, embedded images and
three running services, and renders setup over a loopback-only port forward. Guest
outbound networking is restricted. Screenshots, serial output, status and the CA
fingerprint are retained in the check directory. The throwaway browser ignores
certificate errors for rendering; this does not qualify certificate trust.

This is an unencrypted development root booted with its kernel directly. The
emulator supplies temporary startup units. It does not install from USB or start
Waitron automatically on physical hardware. Firmware, TPM/Secure Boot, retained
disk keys, first-start sealing, kiosk, clock/socket integration and real box/stick/
Android checks remain later B3 work. Demo is still offered here; the next slice
adds the image-consumed installation-origin setting.

After retaining the small results, remove your rehearsal resources. Do not remove
shared images, volumes or build caches. Export the image first with `docker cp`
if you need it; otherwise deleting this container also deletes the built image.

```sh
docker stop waitron-b3-rehearsal
docker rm waitron-b3-rehearsal
docker image rm waitron-b3-tools:rehearsal waitron-b3-app:rehearsal waitron-b3-agent:rehearsal
rm -rf "$inputs"
```
