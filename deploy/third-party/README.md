# Third-party software in the Waitron box image

The box image carries software written by others under their own licences. This folder is
copied to `/app/third-party/` in the image (`deploy/Dockerfile`).

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
