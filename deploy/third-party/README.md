# Third-party software in the Waitron box image

The box image carries software written by others under their own licences. This folder is
copied to `/app/third-party/` in the image (`deploy/Dockerfile`). It covers libvips, Litestream,
the Iosevka font printed text is drawn from, the Moby template the print agent's AppArmor
profile is copied from, and the Material Symbols icons the web apps carry; the npm packages bundled
into the server, the web apps and the print-agent have no notice file yet (`docs/backlog.md`).
The print-agent image, built by the same `deploy/Dockerfile`, does not carry this folder; its own
`/app/third-party/` holds the notices of its Python, described below.

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

## The print agent's AppArmor profile

`deploy/apparmor/waitron-print-agent` is not in either image: `waitron.sh install` copies it to
`/etc/apparmor.d/waitron-print-agent` on the box itself. Everything in it above its D-Bus section is
copied from Moby's `docker-default` template, `apparmor/template.go` in
<https://github.com/moby/profiles> at commit `f0494f1fbb1bbaf2e1b02ee20aab206f32456a63`,
Copyright The Moby Authors, licensed under the Apache License, Version 2.0. The profile's own header
says so and gives the licence's address, <https://www.apache.org/licenses/LICENSE-2.0>, because that
header is the only part of this notice that reaches `/etc/apparmor.d`.

- `licenses/Apache-2.0.txt` is that licence.

## Material Symbols icons

The dashboard, till and setup web apps, served from `/app/web/` in the image, carry icon paths
adapted from Google's Material Symbols icon set (<https://fonts.google.com/icons>), Copyright
Google, licensed under the Apache License, Version 2.0: some of the dashboard's icons in
`apps/dashboard/src/icons.ts`, and the `check` icon `apps/till/src/till-app.ts` and
`apps/setup/src/setup-app.ts` register for the dropdown. Each of those files says so beside the
paths.

- `licenses/Apache-2.0.txt` is that licence.

## The print agent's Python

The print-agent image installs Debian's `python3-minimal` to run the agent's Bluetooth sender,
`rfcomm-send.py`. Its build lists the packages that install adds to the `node:26-slim` base image,
`python3-minimal` and what it pulls in, and copies each one's Debian copyright file, which states
the package's copyright and licences, into `/app/third-party/python3-minimal/` in that image, as
`<package>/copyright`. `PACKAGES.txt` in the same folder names each of those packages and the
version installed. The build fails if the list does not include `python3-minimal`, or if a listed
package has no copyright file.

## Iosevka Term Bold

The server draws the text of every printout as pictures, from a table of letter pictures derived
from the font Iosevka Term Bold, release 34.9.0, Copyright (c) 2015-2026, Renzhi Li (aka. Belleve
Invis). The image carries no font file, only that table, which is compiled into the server. The
font and the table derived from it are licensed under the SIL Open Font License, Version 1.1.

- `iosevka/LICENSE.md` is that licence with the font's copyright line, copied unchanged from the
  font's repository at the release's tag.
- `iosevka/README.md` says where the font came from, with the SHA-256 of each file, and how the
  table was made from it.

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
