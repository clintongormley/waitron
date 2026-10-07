# Independent CUPS raster references

The encoder tests compare complete output against files written by the native CUPS library,
including the page headers and compressed pixels. They use two distinct A4 pages at each
resolution. The pages contain gradients, 128-byte compression boundaries, more than 256 identical
rows, and a final single pixel. You can recreate them from `rasterReferencePages` in
`../raster-reference-pages.ts` and this directory's C harness.

Compile the harness once on a Mac with the command-line developer tools, or on Linux with CUPS
headers and its library installed:

```sh
cc cups-reference.c -lcups -o /tmp/waitron-cups-reference
```

Pass concatenated grey page pixels on standard input, with dimensions, resolution and page count.
The writer sends the encoded document to standard output:

```sh
/tmp/waitron-cups-reference write pwg 2480 3508 300 2 < pages.raw > reference.pwg
/tmp/waitron-cups-reference write apple 2480 3508 300 2 < pages.raw > reference.urf
```

Use `read` to inspect a document's page headers as JSON and save each decoded page as raw grey pixels:

```sh
/tmp/waitron-cups-reference read reference.urf /tmp/reference-page
```

The four gzip fixtures were generated with macOS CUPS 2.3.4 on 2026-10-07. Native readback returned
both pages with identical input pixels, size, resolution, eight-bit grey colour space and one
channel. The Apple reader reported zero in `cupsInteger[0]`; the file's `UNIRAST` header held two,
and the reader decoded both pages. The tests compare that header too. These fixtures require no
CUPS installation to run in CI.

Uncompressed SHA-256 values:

| Fixture      | SHA-256                                                          |
| ------------ | ---------------------------------------------------------------- |
| pwg-300.gz   | abcb7283a50e4511325bcec2e301f65b3af0034908141581bcd75bf97cc6e80e |
| apple-300.gz | 41faf16b17ea766ee2de2d90ef389bd836223f77a16ef331cdaeb8008a6e6129 |
| pwg-600.gz   | 35187ca095dc16a947cc7b6cdff8235c110c160b16d6cca393df0898986140d4 |
| apple-600.gz | 3b6bc262d227e8e020ec91e3bb69ca687b2960c019bcdcf046c32d842e2f9fe2 |

The TypeScript encoder adapts OpenPrinting CUPS v2.4.10's `cups/raster-stream.c`; its Apache notice
ships from `deploy/third-party/cups-raster/NOTICES.txt`. The harness calls the library rather than
copying its implementation. Native CUPS readback of the drawn invoice page also compared every
pixel at both resolutions and matched the CUPS writer's complete bytes. This measures software
encoding; physical printer output and the production transport remain separate checks.
