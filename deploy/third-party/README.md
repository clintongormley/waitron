# Third-party software in the Waitron box image

The box image carries software written by others under their own licences. This folder is
copied to `/app/third-party/` in the image (`deploy/Dockerfile`). It covers libvips and
Litestream; the npm packages bundled into the server, the web apps and the print-agent have no
notice file yet, and the print-agent image, built by the same `deploy/Dockerfile`, has no
`/app/third-party/` at all (`docs/backlog.md`).

## libvips and the libraries built into it

The server shrinks uploaded photos with sharp (Apache-2.0). sharp loads libvips 8.18.6 at run
time as a separate shared library, `libvips-cpp.so.8.18.6`, from the npm package
`@img/sharp-libvips-linux-x64` or `@img/sharp-libvips-linux-arm64`, version 1.3.3. libvips is
licensed LGPL-3.0-or-later, and several libraries built into that file are LGPL too.

- `libvips/NOTICES.md` is that package's own licensing list: every library built into the file
  and the licence each is used under. `libvips/versions.json` names each library's version.
- `licenses/LGPL-3.0.txt` and `licenses/GPL-3.0.txt` are the licence texts. The LGPL version 3
  incorporates the terms of the GPL version 3, so both are provided.

The file is at `/app/node_modules/@img/sharp-libvips-linux-<arch>/lib/libvips-cpp.so.8.18.6`
in the image, where it can be replaced by a modified build of the same library.

### Written offer of source code

"The source code" below means the complete corresponding source code of libvips 8.18.6 and of
every library that `libvips/NOTICES.md` lists as used under the LGPL, in the versions
`libvips/versions.json` names, as built into `@img/sharp-libvips-linux-x64` and
`@img/sharp-libvips-linux-arm64` 1.3.3.

**On a box Waitron supplied.** This offer is valid for at least three years, and for as long as
Waitron offers spare parts or customer support for that model of box. Waitron will give anyone
who possesses this image either a copy of the source code on a durable physical medium
customarily used for software interchange, for a price no more than Waitron's reasonable cost
of physically performing this conveying of source, or access to copy the source code from a
network server at no charge. Ask at info@waitron.io.

**Downloaded from a container registry.** Waitron offers the source code for the image as
published there at no further charge, for as long as that image is offered for download. Ask at
info@waitron.io, naming the image's tag.

These are the terms of sections 6(b) and 6(d) of the GNU General Public License version 3, which
the LGPL version 3 incorporates.

## Litestream

The server streams the venue's database to the owner's storage bucket with Litestream 0.5.17,
which it runs as a separate program, `/usr/local/bin/litestream` in the image. It is the
unmodified release binary the Litestream project publishes for its tag `v0.5.17`
(<https://github.com/benbjohnson/litestream>), and the image build checks it against that
release's published SHA-256 before installing it. Litestream is licensed under the Apache License,
Version 2.0.

- `licenses/Apache-2.0.txt` is that licence, copied from the `LICENSE` file at the tag.
- `litestream/NOTICES.txt` holds the licence and notice files of everything built into the binary:
  the Go standard library and runtime, and every Go module the binary lists as built in. Its header
  names the Litestream version and the command that produced it,
  `node scripts/litestream-notices.mjs`, which reads the module list from `go version -m` run on
  the pinned Linux binaries and copies each module's files from the Go module proxy unchanged,
  except that a text with no final newline is given one.

To regenerate it when the pinned version changes, set `v` to the new version and the two sums to
the SHA-256 values `deploy/Dockerfile`'s `litestream` stage pins for the `x86_64` and `arm64`
assets, then run this from the repository root:

```sh
v=0.5.17
sum_x86_64=<the x86_64 sum from deploy/Dockerfile's litestream stage>
sum_arm64=<the arm64 sum from deploy/Dockerfile's litestream stage>
d=$(mktemp -d)
for arch in x86_64 arm64; do
  curl -fsSL -o "$d/$arch.tar.gz" \
    "https://github.com/benbjohnson/litestream/releases/download/v$v/litestream-$v-linux-$arch.tar.gz"
done
printf '%s  %s\n' "$sum_x86_64" "$d/x86_64.tar.gz" "$sum_arm64" "$d/arm64.tar.gz" | sha256sum -c -
for arch in x86_64 arm64; do
  mkdir "$d/$arch" && tar -xzf "$d/$arch.tar.gz" -C "$d/$arch" litestream
  go version -m "$d/$arch/litestream" > "$d/mods-$arch.txt"
done
node scripts/litestream-notices.mjs deploy/third-party/litestream/NOTICES.txt \
  "$d/mods-x86_64.txt" "$d/mods-arm64.txt"
```

The Go toolchain that runs `go version -m` need not be the one the binaries were built with.
Measured 2026-09-24: a go1.25.1 toolchain read binaries built with go1.25.14.
