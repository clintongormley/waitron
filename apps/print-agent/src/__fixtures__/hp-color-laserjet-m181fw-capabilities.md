# HP capability reply, captured 2026-10-08

You can use `hp-color-laserjet-m181fw-capabilities.ipp` to exercise format selection against the
reply captured at `2026-10-08T16:47:38+02:00` from the owner's printer address,
`http://192.168.20.56:631/ipp/print`. The request was IPP 2.0 Get-Printer-Attributes,
with request id 1 and these requested attributes:

- `document-format-supported`
- `media-supported`
- `urf-supported`
- `pwg-raster-document-resolution-supported`
- `pwg-raster-document-type-supported`

The hand-encoded request was sent with `curl --silent --show-error --max-time 5`,
`Content-Type: application/ipp` and `--data-binary @hp-capabilities-request.ipp`.
Curl exited 0 and reported HTTP 200. The captured request was later compared byte for byte
with `buildCapabilitiesQuery({host: "192.168.20.56", port: 631, resourcePath: "/ipp/print"})`.
The saved fixture was also compared byte for byte with the captured response.

| Capture  | Bytes | SHA-256                                                            |
| -------- | ----- | ------------------------------------------------------------------ |
| Request  | 293   | `f10f50f72343abd2433a62584eb4240b7ba2584ea2a0f9f2d9f7d829ee7492ad` |
| Response | 1041  | `6f607e767afeba16c3b53fd9faefc894e3c3b49eb2b52dc44c5aff6bc7a7508a` |

The response reports `application/pdf` and `image/urf`, A4 and US letter, and `W8`/`RS600`.
It reports no `image/pwg-raster` format or PWG raster attributes. The selection test checks
the complete format list against this fixture. Removing the PDF attribute from these bytes
selects Apple Raster at 600 dpi in the test. This capture sends no document or Print-Job;
it does not establish what printed output looks like.

The fixed endpoint is the printer address recorded in the historical design. This query does
not request a make/model or serial number, so it adds no independent identity check.

The parser and raster choice use these protocol sources:

| Source                                                                                      | Source words                             | Application                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [RFC 8010, section 3.9](https://www.rfc-editor.org/rfc/rfc8010.html#section-3.9)            | “OCTET-STRING consisting of nine octets” | Read the resolution's two signed dimensions and its units byte; select square 300 or 600 dpi, which the current invoice encoder accepts. |
| [PWG chair's document-type explanation](https://www.pwg.org/pipermail/ipp/2014/018340.html) | “8-bit grayscale raster data”            | Require `sgray_8` for the PWG encoder's grey output.                                                                                     |

Discovery sends this query (`createOfficePrinterClassifier`, `ipp-probe.ts`). No production
office-printer job transport is connected yet.
