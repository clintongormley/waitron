# Full invoices by email as a PDF, and on an office printer (A231d)

> **Update, 2026-10-05 (A261 step 2):** The receipt-printing setting described under
> **What is already there** records the location-wide setting at the time of this design. The
> [Departments and zones plan](../plans/2026-10-04-departments-and-zones.md) moves that choice to a
> department with an optional zone override; a sale without a zone defaults to automatic printing.

**Status:** amended proposal for owner approval, 2026-10-03. The owner approved decisions 1–5 of the first version, changed decision 6, and answered the second version's decisions 7–9 (see [Owner decisions](#owner-decisions-2026-10-03)); this third version carries those answers and compares Debian's own printing system with drawing pages ourselves ([below](#debians-printing-system-cups-instead-of-drawing-pages-ourselves)). Nothing here is built. The build is queued only after the owner approves this version, and it follows the A231 build, which it depends on.

## What this adds, and what it builds on

The [A231 design](2026-10-03-full-invoices-at-till-design.md) lets the till issue a full invoice (an F1, which names the customer) and prints it on the receipt printer. It left two ways of delivering that invoice for later ("Email PDF" and "A4 office printer" in its table "Deliver a readable F1"). The owner asked for both on 2026-10-03: "we should also email a pdf to the customer and have a way of printing it to a normal printer".

This design covers:

1. Turning a filed F1 into a PDF.
2. Emailing that PDF to the customer, with the consent the law asks for.
3. Setting up a live venue's outgoing mail server without a terminal, because a live venue must have one before it can email an invoice.
4. Printing it on any ordinary A4 office printer on the venue's network, added through the same add-printer dialog as a receipt printer, through the print agent (the small program on the box that sends jobs to printers).
5. Sending or printing it again later, from the till and from the dashboard.

Email and A4 printing are built together, as one build (owner, 2026-10-03). It covers full invoices (F1) only. A simplified invoice (F2, the ordinary till receipt) by email is not asked for and is not designed here.

Everything below reads the F1 facts the A231 build will store at issue: the customer's tax ID, legal name and address, the taxpayer's domicile, the net line figures and the VAT breakdown. None of it exists until the A231 build lands.

Two sentences in A231's design change with this one:

- Its table says "A PDF email alone is not the selected delivery guarantee". With the consent below, an emailed PDF becomes a valid way to deliver the original.
- Its "F1 not delivered" state becomes one of this design's delivery records, rather than a second mechanism beside them.

Terms used below:

- **The asesor** is the venue's tax adviser.
- **SMTP** is the standard way one computer hands email to a mail server.
- **IPP** is the standard office printing protocol, spoken on network port 631.
- **A raster** is a page sent as a grid of dots (a picture of the page) rather than as a PDF the printer lays out itself. **PWG Raster** and **Apple Raster (URF)** are the two raster formats this design sends. **PCLm** is a third, which the HP below lists and this design does not use.
- **mDNS** is how devices on a local network announce themselves ("I am a printer, at this address") without a central directory.
- **Sealing** a credential means storing it encrypted with the box's own key, as Waitron already stores a payment provider's keys.
- **An append-only table** is one whose rows the database refuses to change or delete once written.
- **CUPS** is the printing system Linux and macOS use: a print server that queues jobs and converts documents into what each printer takes. **Ghostscript** and **Poppler** are two of the programs it converts with.
- **Avahi** is the service that does mDNS on a Linux machine.

## Owner decisions, 2026-10-03

The first version asked six questions. The owner's answers, relayed by the supervising session at about 08:45:

1. **Approved.** One original, chosen at issue; at most one attempt at the original unless it certainly failed; no courtesy PDF beside a paper original in the first build.
2. **Approved.** The consent statement's content, and a venue contact email in the location settings as the way to withdraw after leaving.
3. **Approved.** Every delivered PDF is stored in the database, and therefore in the bucket.
4. **Managers only** may email or download an invoice from the dashboard.
5. **Approved.** `pdfkit` and a bundled font, subject to the build's first-task checks.
6. **Changed.** Build A4 printing and email together, not one first. A4 printing must be general — "if the user has an A4 printer available we should try to use it" — with office printers added as invoice printers through the same add-printer dialog as receipt printers. The owner asked whether most modern printers accept PDF directly; [What office printers accept](#what-office-printers-accept) answers from the standards. And "when a restaurant goes live with waitron they need to have an smtp gateway set up. before that (eg in the demo) we can use our test mail gateway": [Set up email for a live venue](#set-up-email-for-a-live-venue) designs that.

The second version asked three more. The owner's answers, relayed at about 10:05:

7. **(b)** A venue preparing to go live may send real invoice email when a mail server is set; a demo always uses the captured inbox. The backlog item "A venue preparing to go live sends real email through SMTP" stays open; it is not replaced.
8. **(a)** A live venue's setup requires email, and Continue waits for an accepted test message.
9. **(a)** Network printers taking PDF, PWG Raster or Apple Raster first. Printers taking only PCLm, PCL or PostScript, printers announcing only encrypted IPP, and USB office printers are later work.

The owner also asked, at about 08:55: "can we install IPP everywhere as part of debian? does that immediately give us compatibility with most printers, or do we still need to choose drivers?" [Debian's printing system instead of drawing pages ourselves?](#debians-printing-system-cups-instead-of-drawing-pages-ourselves) answers it with measurements, and this version asks one new question, in [What the owner decides](#what-the-owner-decides).

## Primary-source register, checked 2026-10-03

Each excerpt was read from the raw page fetched with `curl -L -sS`, with the HTML tags stripped and the sentence found by text search. These are the sources the claims below rely on. The A231 design's register also applies; its rows are not repeated.

| Claim | Primary source and short exact excerpt |
| --- | --- |
| An emailed PDF is an electronic invoice | [RD 1619/2012, art. 9.1](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696): «Se entenderá por factura electrónica aquella factura … que haya sido expedida, transmitida y recibida en formato electrónico». |
| Sending one needs the recipient's consent, except under the mandatory business regime | Same, art. 9.2: «estará condicionada a que su destinatario haya dado su consentimiento, excepto en los supuestos de factura electrónica obligatoria establecidos en el artículo 8 bis». |
| A consumer keeps the right to paper; consent must be express, given beforehand, and explain delivery and withdrawal | [RDL 1/2007, art. 63.3](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555): «estos tendrán derecho a recibir la factura en papel»; «haya obtenido previamente el consentimiento expreso del consumidor»; «La solicitud del consentimiento deberá precisar la forma en la que se procederá a recibir la factura electrónica, así como la posibilidad de que el destinatario que haya dado su consentimiento pueda revocarlo y la forma en la que podrá realizarse dicha revocación»; paper «no podrá quedar condicionado al pago de cantidad económica alguna». |
| Proof that the invoice comes from the venue and is unaltered | RD 1619/2012, art. 8.3: «podrán garantizarse mediante los controles de gestión usuales de la actividad empresarial o profesional», which «deberán permitir crear una pista de auditoría fiable»; art. 8.4: «se presumirá acreditada cuando se haya expedido utilizando un sistema o programa informático en conformidad con los requisitos» of the billing-software regulation; art. 10.1 applies the same means to electronic invoices («por cualquiera de los medios señalados en el artículo 8»), and lists an advanced electronic signature among the ways that guarantee it outright. Whether an unsigned PDF from Verifactu-compliant software is enough is asesor question 4. |
| One original per invoice; a duplicate only for several recipients or a lost original, and marked | RD 1619/2012, art. 14: «sólo podrán expedir un original de cada factura»; duplicates «únicamente será admisible en los siguientes casos» (several recipients; «pérdida del original por cualquier causa»); «deberá hacerse constar la expresión «duplicado»». |
| A duplicate's equal legal effect covers only those two cases | Same, art. 14.3: «Los ejemplares duplicados a que se refiere el apartado anterior tendrán la misma eficacia que los correspondientes documentos originales». |
| The original must be sent to the customer at issue (a business customer: by the 16th of the next month) | Same, arts. 17–18: «Los originales de las facturas … deberán ser remitidos … a los destinatarios»; «en el mismo momento de su expedición o bien, cuando el destinatario sea un empresario o profesional que actúe como tal, antes del día 16 del mes siguiente». |
| A PDF needs the same QR as paper | [Orden HAC/1177/2024, art. 20.1](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138): «tanto si está impresa en soporte papel como si se trata de la imagen de la misma en soporte digital, incluirá» the QR and the legend; only a structured invoice may carry the URL instead (art. 20.2: «no siendo necesario incluir el propio código «QR»»). [AEAT's QR FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/posibilidad-remision-informacion-factura-parte-receptor.html): «se transmite en formato electrónico visible (PDF, TIF, etc) e imprimible, la incorporación del QR no tendrá especialidades respecto de la que corresponde a la emisión en papel». |
| QR size, error correction and place on a page | Orden HAC/1177/2024, art. 21.1: «un tamaño entre 30x30 y 40x40 milímetros»; «nivel M (medio) de corrección de errores» (how much of the code may be damaged and still read). AEAT FAQ: «antes de que empiece el contenido»; «preferiblemente centrado»; «si la factura ocupara más de una página, deberá figurar en la primera página y no en las siguientes». The legend must have «un tipo de letra y tamaño bien visibles, similares a los del resto de datos de la factura» (art. 20.1.b). |
| Paper is not compulsory when invoices are electronic | AEAT FAQ: «NO es obligatorio imprimir en papel la factura, siempre que se utilicen sistemas de facturación electrónica (ya sea estructurada o no estructurada)». |
| Invoices kept electronically are kept in the format they were sent in | RD 1619/2012, art. 21.1, on keeping by electronic means («La conservación por medios electrónicos»): «se asegure su legibilidad en el formato original en el que se hayan recibido o remitido». Art. 21.2 requires the tax agency's online access to what is kept. How long: art. 19 points to Ley 58/2003, whose [art. 66](https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186) sets «Prescribirán a los cuatro años» and art. 70.1 ties formal obligations to that period. Whether a longer commercial-law period applies is not checked here. |
| When the business regime applies, a PDF alone is not enough | [RD 238/2026, art. 7.1](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295): «un mensaje informático de carácter estructurado, ajustado al modelo semántico de datos EN16931» — the EU's standard for machine-readable invoices — in one of four data formats (CII, UBL, EDIFACT or Spain's Facturae). Art. 4.1 exempts simplified invoices «a menos que se trate de facturas simplificadas cualificadas». Final provision 4 starts the clock «desde la entrada en vigor de la orden ministerial»: «Doce meses después» for businesses whose turnover exceeded €8m in the previous year, «Veinticuatro meses después, para el resto». The obligation (art. 3.1) falls on the business issuing the invoice, so the turnover is the venue's own. |

## Printing standards, checked 2026-10-03

Fetched with `curl -L -sS`; PDFs turned into text with `pdftotext -layout` (poppler), web pages with their tags stripped; each excerpt found by text search, with lines the layout split joined. AirPrint and Mopria publish no list of required formats, so their rows say what was found instead.

| Claim | Primary source and short exact excerpt |
| --- | --- |
| IPP Everywhere 1.0 required PDF of newer printers | [PWG 5100.14-2013 (v1.0)](https://ftp.pwg.org/pub/pwg/candidates/cs-ippeve10-20130128-5100.14.pdf), §6: «Printers MUST support documents conforming to the PWG Raster Format [PWG5102.4] ("image/pwg-raster") and JPEG File Information Format Version 1.02 [JFIF] ("image/jpeg")»; «IPP/2.1 and IPP/2.2 Printers MUST and IPP/2.0 Printers SHOULD support documents conforming to Document management — Portable document format — Part 1: PDF 1.7 [ISO32000] ("application/pdf")». |
| IPP Everywhere 1.1, the current version, requires PWG Raster and only recommends PDF | [PWG 5100.14-2020 (v1.1)](https://ftp.pwg.org/pub/pwg/candidates/cs-ippeve11-20200515-5100.14.pdf), §6 (lines 969–976): «Printers MUST support documents conforming to the PWG Raster Format [PWG5102.4] ("image/pwg-raster"). Color Printers MUST and monochrome Printers SHOULD support documents conforming to the JPEG File Information Format Version 1.02 [JFIF] ("image/jpeg")»; «Printers SHOULD support documents conforming to Document management — Portable document format — Part 1: PDF 1.7 [ISO32000] ("application/pdf")». The PWG's [summary page](https://www.pwg.org/ipp/everywhere.html): «Required: IPP/2.0, DNS-SD, PWG Raster and JPEG JFIF file formats (JPEG only required for color printers)»; «Recommended: PDF, IPP-USB». |
| The draft 2.0 keeps PDF recommended for a physical printer | [Working draft, 30 April 2026](https://ftp.pwg.org/pub/pwg/ipp/wd/wd-ippeve20-20260430.pdf), §7 (lines 972–974): «Printers representing Logical Devices MUST and Printers representing Physical Devices SHOULD support documents conforming to Document management — Portable document format — Part 2: PDF 2.0 [ISO32000] ("application/pdf")». A logical device is a print server or service, not a printer. |
| An IPP Everywhere printer that announces itself announces IPP | v1.1, lines 579–580: «Printers that support DNS-SD MUST also advertise the "_ipp._tcp" (generic IPP) and "_print._sub._ipp._tcp" (IPP Everywhere™) services over mDNS». |
| AirPrint: no published requirement found; Apple's example printer offers no PDF | Checked: [About AirPrint](https://support.apple.com/en-us/102895), [developer.apple.com/airprint](https://developer.apple.com/airprint/), and Apple's Bonjour Printing Specification 1.2.1, which defines the `pdl` key only as «A comma-delimited list of MIME media types supported by the printer». Apple's WWDC 2016 session 725 slides, "Deploying AirPrint in Enterprise", show an example printer announcing «pdl=image/urf,image/jpeg». |
| Mopria: the print specification is for members | [mopria.org/specifications](https://mopria.org/specifications): «Only Mopria Alliance members may certify their devices»; the membership page lists «Access to final specifications» as a member benefit. [Mopria blog, 16 September 2025](https://blog.mopria.org/2025/09/16/the-future-is-driverless-why-driverless-printing-is-the-next-leap-forward/), quoting Adobe: «The Mopria print specification supports the use of PDF, PCLm, and pwg-raster». |
| CUPS prefers PDF when a printer offers it, and writes Apple Raster | Read in source; the 2026-10-03 stand-in test ([below](#debians-printing-system-cups-instead-of-drawing-pages-ourselves)) then saw a PDF sent to a printer listing PDF and PWG Raster, and Apple Raster written for one listing only Apple Raster and JPEG. [CUPS 2.4.x `cups/ppd-cache.c`](https://github.com/OpenPrinting/cups/blob/2.4.x/cups/ppd-cache.c), lines 3603–3610, gives PDF a conversion cost of 10 and URF and PWG Raster 100 each: «application/vnd.cups-pdf application/pdf 10 -», «image/urf image/urf 100 -», «image/pwg-raster image/pwg-raster 100 -». [`cups/raster-stream.c`](https://github.com/OpenPrinting/cups/blob/2.4.x/cups/raster-stream.c), line 564, has a `CUPS_RASTER_WRITE_APPLE` mode beside `CUPS_RASTER_WRITE_PWG`. CUPS is under the Apache 2.0 licence. |
| Mail submission ports | [RFC 8314](https://www.rfc-editor.org/rfc/rfc8314.txt), §3.3: «(default port 465), a TLS handshake begins immediately»; «The STARTTLS mechanism on port 587 is relatively widely deployed». |
| How many printers take PDF: not found | The [PWG's certified-printer list](https://www.pwg.org/printers/) has no document-format field in its data file (`printers.json`). |
| CUPS sets up a driverless printer by asking it, and calls every other kind of setup deprecated | [CUPS 2.4.10 `man/lpadmin.8`](https://github.com/OpenPrinting/cups/blob/v2.4.10/man/lpadmin.8), lines 86–87: «the model "everywhere" queries the printer referred to by the specified IPP *device-uri*»; «Note: Models other than "everywhere" are deprecated and will not be supported in a future version of CUPS.» |
| CUPS 2.4.10 looks for the PWG Raster resolutions under the wrong type, fixed in 2.4.12 | [CUPS 2.4.10 `cups/ppd-cache.c`](https://github.com/OpenPrinting/cups/blob/v2.4.10/cups/ppd-cache.c), line 3475: `ippFindAttribute(supported, "pwg-raster-document-resolution-supported", IPP_TAG_KEYWORD)`. Commit [63f5c71f0](https://github.com/OpenPrinting/cups/commit/63f5c71f0) (2025-01-14), «ppd-cache.c: Fix IPP tag for pwg-raster-document-resolution-supported», changes it to `IPP_TAG_RESOLUTION`. GitHub's comparison places the commit after tag v2.4.11 and before v2.4.12. |
| What CUPS does with a failed job | [CUPS 2.4.10 `man/cupsd.conf.5`](https://github.com/OpenPrinting/cups/blob/v2.4.10/man/cupsd.conf.5), lines 136–146: «ErrorPolicy abort-job — Specifies that a failed print job should be aborted (discarded) unless otherwise specified for the printer»; «ErrorPolicy retry-job — Specifies that a failed print job should be retried at a later time unless otherwise specified for the printer»; «The 'stop-printer' error policy is the default.» Debian 13's `/etc/cups/cupsd.conf` sets `ErrorPolicy retry-job` (read in the measured image). |
| CUPS's IPP sender keeps trying an unreachable printer for 7 days | [CUPS 2.4.10 `backend/ipp.c`](https://github.com/OpenPrinting/cups/blob/v2.4.10/backend/ipp.c): line 448, `contimeout  = 7 * 24 * 60 * 60;`; lines 583–591 read a `contimeout` option from the printer's address; lines 758–763 give up with «The printer is not responding.» only once that time has passed; lines 768–771 print «The printer may not exist or is unavailable at this time.» between attempts. |
| cups-filters holds the driverless converters, with Ghostscript | [cups-filters 1.28.17 `README`](https://github.com/OpenPrinting/cups-filters/blob/1.28.17/README), lines 57–61: «CUPS, this package, and Ghostscript contain some rudimentary printer drivers and especially the filters needed for driverless printing (currently PWG Raster, Apple Raster, PCLm, and PDF output formats, for printers supporting IPP Everywhere, AirPrint, Wi-Fi Direct, and other standards)». |
| ipp-usb needs Avahi running | [ipp-usb `README.md`](https://github.com/OpenPrinting/ipp-usb/blob/master/README.md), lines 81–84: «This program has very few external dependencies, namely: `libusb` for USB access; `libavahi-common` and `libavahi-client` for DNS-SD; Running Avahi daemon» (the README's list items joined with semicolons). Debian 13's `/etc/ipp-usb/ipp-usb.conf` (read in the measured image): `http-min-port = 60000`, `dns-sd = enable      # enable \| disable`, `interface = loopback # all \| loopback`. |
| Ghostscript's licence | Debian 13's `/usr/share/doc/ghostscript/copyright` (read in the measured image), lines 90–97: «GPL Ghostscript is free software; you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.» `License: AGPL-3+`. |

## Measured on 2026-10-03

The owner's office printer was asked, read-only, which document types it accepts. The command was `ipptool -t ipp://NPIDE0887.local:631/ipp/print` with one Get-Printer-Attributes request (IPP's "tell me about yourself" question). It reported:

- `printer-make-and-model = HP ColorLaserJet MFP M178-M181`;
- `ipp-versions-supported = 1.0,1.1,2.0`;
- `operations-supported` including `Print-Job` and `Get-Job-Attributes`;
- `document-format-supported` including `application/pdf`;
- `media-supported` including `iso_a4_210x297mm`.

The fresh-context review repeated the query and got the same answer. The second office printer the Mac knows (an HP M282nw) did not answer, so this is one printer. The raw reply bytes of that query were not saved. The repository already holds this printer's raw reply to the paper-size question alone (`apps/print-agent/src/__fixtures__/hp-color-laserjet-m181fw-media-supported.ipp`).

A second read-only query at about 09:05, asking for the format attributes by name (`ipptool -t` with a Get-Printer-Attributes request naming `document-format-supported`, `urf-supported`, `pwg-raster-document-resolution-supported` and others), reported the whole list:

- `document-format-supported = image/urf, application/PCLm, application/octet-stream, application/pdf, application/postscript, application/vnd.hp-PCL, application/vnd.hp-PCLXL, image/jpeg`;
- `document-format-default = application/pdf`;
- `urf-supported = V1.5, CP99, W8, OB10, PQ3-4-5, ADOBERGB24, DEVRGB24, DEVW8, SRGB24, IS1, MT1-2-3-5-12, RS600` (it takes Apple Raster at 600 dots per inch only — `RS600` — in 8-bit grey among others);
- `ipp-features-supported = airprint-2.1`;
- no `pwg-raster-document-resolution-supported` value, and `image/pwg-raster` is not in the format list, although the printer's USB-style device id (`printer-device-id`) lists `PWG_RASTER` among its languages.

So this printer would be sent PDF, and could be sent Apple Raster, but not PWG Raster: a format is chosen from `document-format-supported`, never from the device id. The reply was saved as text on the Mac where it ran (`/tmp/a231d-research/hp-m181fw-gpa.txt`), which is not a lasting receipt; the build captures it as raw bytes into a fixture beside the existing one (plan task 5).

**The image library already in the box can draw a page as dots.** `sharp` (0.35.4, which `packages/media` uses and the box image already ships) turned an A4-sized SVG drawing — a 413-dot black square and a small triangle, standing in for a QR code and a letter's outline — into a 2480 × 3508 one-channel grey image (A4 at 300 dots per inch) in 29 ms, on the owner's Mac (Apple silicon, Node v26.7.0). It counted 173,569 dark dots: the square's 170,569 plus about 3,000 for the triangle, which is what a correct drawing gives. The same drawing at 600 dots per inch (4960 × 7016 dots, the square 827 dots wide) took 107 ms and counted 695,929 dark dots, again exactly the square plus the triangle; the whole Node process, with `sharp` loaded, peaked at 227 MB resident (`/usr/bin/time -l`), against 151 MB for the 300-dot run. A repeat by the review took 27–37 ms and 107–116 ms with the same dot counts. Not measured: the box's processor, a page of real text, or the server's memory with everything else it runs.

## What the code does today

- **Email.**
  - There is one kind of email: account email (invitations, password resets and email changes). Nodemailer sends it inline, while the request waits ([account-email.ts:77](../../../apps/server/src/account-email.ts#L77)).
  - The message type has no attachments ([account-email.ts:18-25](../../../apps/server/src/account-email.ts#L18-L25)), and there is no queue or retry.
  - A failure is logged as `account_email.send_failed` without the error, because an SMTP address can contain a password ([management-api.ts:191-197](../../../apps/server/src/management-api.ts#L191-L197)).
  - Mail goes through SMTP when the `email.smtp` credential is set. Otherwise, in a demo or a venue preparing to go live, the box captures it in its own inbox, and in a live venue it is not sent at all ([email-delivery.ts:15-33](../../../apps/server/src/email-delivery.ts#L15-L33)).
  - The credential can only be set with the `waitron-credentials set --purpose email.smtp` command ([apps/server/README.md:303](../../../apps/server/README.md#L303)), which needs a terminal on the box.
  - Practice mode is a demo or a venue preparing to go live ([boot.ts:1343](../../../apps/server/src/boot.ts#L1343)). A development server is treated as practice for email ([boot.ts:1463](../../../apps/server/src/boot.ts#L1463)), so it captures mail in every mode unless an SMTP server is set.
  - A live venue is never a promoted practice venue: the setup wizard provisions it fresh in "live" mode ([setup-api.ts:440-460](../../../apps/server/src/setup-api.ts#L440-L460); [CLAUDE.md §5](../../../CLAUDE.md), "One database per environment"). The configuration a prepare venue hands to it carries no credentials: the credentials module declares `configurationTransfer: { kind: "none" }` ([modules.ts:207-218](../../../packages/composition/src/modules.ts#L207-L218)). So an SMTP server set up while preparing would not reach the live venue.
  - The live setup already collects one secret: the AEAT certificate travels in the provision request as `aeatCert` ([setup-api.ts:474-490](../../../apps/server/src/setup-api.ts#L474-L490)).
  - The dashboard already seals a provider credential: connecting a payment provider stores it with `putCredential` ([payments-api.ts:393-406](../../../apps/server/src/payments-api.ts#L393-L406)).
  - The capture service accepts messages of at most 1 MB (`MP_MAX_MESSAGE_SIZE: 1` in [compose.yml:86](../../../deploy/compose.yml#L86); Mailpit's documentation gives the value in MB).
- **PDF.**
  - No package makes PDFs.
  - The box image installs no browser and no font package ([Dockerfile:75,84,137](../../../deploy/Dockerfile#L137)). The only font file in the tree that a PDF might reuse is the dashboard's `google-sans-medium-latin.woff2`: one weight, Latin characters only.
  - The server already makes QR codes at error-correction level M ([qr-matrix.ts:9-10](../../../apps/server/src/qr-matrix.ts#L9-L10)).
- **Receipts.**
  - The receipt is laid out straight into receipt-printer commands (ESC/POS). There is no layout model that a second output could share ([receipt-ticket.ts:125-134](../../../apps/server/src/receipt-ticket.ts#L125-L134)).
  - In a demo or a venue preparing to go live, every receipt carries a practice warning ([receipt-ticket.ts:158-162](../../../apps/server/src/receipt-ticket.ts#L158-L162)).
  - Whether a receipt prints by itself after a sale follows the location's receipt setting ([receipt-print.ts:117-129](../../../apps/server/src/receipt-print.ts#L117-L129)).
- **Office printers.**
  - The print agent finds network printers two ways: the announcement printers make for a raw print port (`_pdl-datastream._tcp`, [network.ts:7](../../../apps/print-agent/src/network.ts#L7)), and a sweep of the local network for port 9100 ([sweep.ts:10](../../../apps/print-agent/src/sweep.ts#L10)). A printer that offers IPP but has its raw port switched off is not found.
  - It then greys office printers out. It asks a printer's IPP service only for `media-supported` ([ipp-probe.ts:49](../../../apps/print-agent/src/ipp-probe.ts#L49)), and the dashboard shows "Office printer — not supported for receipts" instead of Add ([strings.ts:952](../../../apps/dashboard/src/i18n/strings.ts#L952), decided at [printers-screen.ts:1069-1072](../../../apps/dashboard/src/screens/printers-screen.ts#L1069-L1072) and drawn at [printers-screen.ts:2905-2910](../../../apps/dashboard/src/screens/printers-screen.ts#L2905-L2910)).
  - The printing package already draws text as dots, for receipts: a fixed-width bitmap font of 12 × 28 dots per character, made from Iosevka ([raster-text.ts](../../../packages/printing/src/raster-text.ts), [glyphs.ts](../../../packages/printing/src/glyphs.ts)).
  - A printer row is `usb`, `network_tcp`, `bluetooth` or `cloud_poll`, with a 58 or 80 mm roll. Database checks hold each of those lists ([printers.ts:55-65](../../../packages/db/src/schema/printers.ts#L55-L65)).
  - Six tables point at `printers`: `devices`, `tills`, `drawer_opens`, `station_printers`, `watcher_printers` and `print_jobs`. _2026-10-04: superseded by A238 (`docs/superpowers/specs/2026-10-03-till-is-a-device-design.md`): `tills` is gone and `device_profile_printers` points at `printers` too; list them again before relying on this._
  - A print job's payload is described as ESC/POS bytes ([print-jobs.ts:51-53](../../../packages/db/src/schema/print-jobs.ts#L51-L53)).
- **Print-job delivery is deliberately "at least once".**
  - A job left half-sent for more than 60 seconds can be claimed again and printed twice ([runtime.ts:22-33](../../../packages/printing/src/runtime.ts#L22-L33)).
  - A job that finished can be resent from the print-jobs screen as the same bytes ([outbox.ts:54-65](../../../packages/printing/src/outbox.ts#L54-L65)).
  - Both are right for a kitchen ticket and wrong for an invoice original.
- **Customers.** There is no customer table and no consent record anywhere. Only staff have email columns. A location row has an address but no phone or email.

## The rules this design follows

**One original.** Each F1 has one original (art. 14.1), and the customer receives it at issue (arts. 17–18). So **the customer chooses one way of receiving the original**: on the receipt printer (A231's default), on A4 paper, or by email. Whatever is sent or printed after that is marked «duplicado».

The law allows a duplicate when the original is lost (art. 14.2.b), and in practice the only reason to send an invoice again is that the customer does not have it. Whether a courtesy PDF may go with a paper original, and how it is marked if so, is asesor question 1. The first build does not offer it. When Email or A4 is chosen, the receipt printer does not also print the F1 by itself.

**At most one attempt at the original, unless it certainly failed.** Only a delivery that certainly did not reach the customer may be tried again as the original:

- an email the mail server refused;
- an A4 job the printer refused before printing anything.

Anything uncertain makes every later send a «duplicado»:

- no answer;
- the box stopping mid-send;
- a job the printer aborted after starting it.

By email or on A4 this means two originals of one invoice cannot be sent. A duplicate has the original's legal effect only in the two cases art. 14.2 allows (art. 14.3), and whether an uncertain outcome counts as a lost original is asesor question 5, as is whether a retry after a certain failure is still the original.

**The receipt printer is the exception, for now.** The F1 on the receipt printer (A231's default) goes through the existing print-job queue, which delivers at least once and lets a finished job be resent as the same bytes (above). So an F1 receipt job must refuse the print-jobs screen's resend; a further copy goes through the invoice's own Reprint, which marks it «duplicado». What the queue cannot stop is a second print after a lapsed claim. That risk is stated here, and asked as asesor question 5.

**Consent before email.** An emailed PDF is an electronic invoice (art. 9.1). Every recipient must consent before one is sent (art. 9.2). A consumer must consent expressly and beforehand, be told how the invoice arrives and how to withdraw, and keep free paper (art. 63.3). The till cannot know whether the person asking for an F1 is acting as a consumer. So **every email delivery asks for the same express consent**, worded for the consumer case, which also covers art. 9.2 for a business.

**Business customers after the regime starts.** Once RD 238/2026 applies, an invoice to a Spanish business must be a structured EN 16931 message (art. 7.1), and a PDF alone does not satisfy that. The regime's start depends on a ministerial order not yet published. A231 already holds Spanish business sales behind the owner and asesor's answer on that date. This design is for the period before then; a structured invoice is separate work.

**Nothing external makes a sale wait** ([CLAUDE.md §5](../../../CLAUDE.md)). Rendering, emailing and A4 printing all happen after the sale has committed, through queues. The worker never holds a database transaction while it renders, talks to a mail server or talks to a printer: the database lets only one write transaction run at a time, so that would make every sale wait. A failure leaves the sale filed and the invoice marked as not delivered, with a way to deliver it.

**No customer details in logs.** No log line, error detail or alert carries the customer's email, tax ID, name or address. A failure is recorded as a short code ("refused by the mail server", "no answer", "printer out of paper"), never as the mail server's or printer's own message, which can repeat the address.

## Make the PDF

**One layout model, three outputs.** The A231 build will lay out the paper F1 for the receipt printer. Build it, or reshape it in this build's first task, as a format-neutral F1 document: sections, lines, totals, the QR text and the legend, all read from the stored F1 facts. Then the roll printer, the PDF and the A4 page drawn as dots (for an office printer that takes no PDF, [below](#what-office-printers-accept)) all draw the same thing, and a reprint, the paper copy, the PDF and the printed page can never disagree about a figure.

**Make it on the server with a JavaScript PDF library, not a browser.** Recommendation: `pdfkit`. It is a JavaScript library that draws text, lines and shapes and embeds fonts, and it wraps long text for us. The alternative, `pdf-lib`, would need our own text wrapping. A headless browser is rejected: none is in the image, it is large, and the image builds front ends without ever opening them ([CLAUDE.md §2](../../../CLAUDE.md)). Two risks to settle in the build's first task:

- **Bundling.** A library that reads its own files at run time can break once bundled, as `sharp` does ([CLAUDE.md §2](../../../CLAUDE.md), "esbuild bundles sharp without complaint"). The build makes a PDF from the bundled server, not only from the tests.
- **Font.** The image has no system fonts, so the PDF embeds one. It must cover Spanish and every other receipt language, and its licence notice ships in `/app/third-party/` ([CLAUDE.md §3](../../../CLAUDE.md)). The dashboard's Google Sans file has one weight and Latin characters only, so a second weight, or a different font, is likely needed.

**The page.** A4 portrait.

- **The QR comes first.** It is at the top, before any content, centred, on the first page only. It is 35 mm square (inside the 30–40 mm range), at level M, with its caption, and the «VERI*FACTU» legend in the same type size as the rest of the invoice.
- **Then the content A231 sets out for the paper F1, in conventional columns:**
  - issuer legal name, tax ID and domicile;
  - series and number, issue date, and the operation date when it differs;
  - customer legal name, tax ID and full address;
  - each line with quantity, unit price before VAT, discount, taxable base, rate and VAT;
  - the per-rate summary and the total;
  - payment and tip information, kept apart from the tax figures.
- **Layout rules.** Long names and addresses wrap and are never cut. A duplicate carries «duplicado» near the top. A demo or a venue preparing to go live carries the same practice warning the paper receipt does. The file name is the series and number, for example `FF-000123.pdf`.

**Keep the exact file that was delivered.** Waitron keeps its invoices electronically, so art. 21.1 asks for a sent invoice to be kept in the format it was sent in. Each PDF that is emailed or printed on A4, as an original or a duplicate, is stored once in an append-only table, with its SHA-256 fingerprint and the sale it belongs to. A page sent to an office printer as dots is stored as the PDF drawn from the same layout; the dots themselves are not kept.

The database streams to the owner's bucket, so the bucket holds these files. After A231 it will also hold the same customer name, tax ID and address in the sale row. F1s are rare in a restaurant, but the build measures a realistic file's size and records it.

## Email it

**At issue, in A231's full-invoice dialog.** The dialog gains a delivery choice: "Printed receipt" (default), "A4 printer" (only when the venue has an invoice printer, below) and "Email".

Choosing Email shows an email address field and a consent box, unticked by default. Next to the box, a short statement says:

- the invoice will be sent as a PDF to this address instead of on paper;
- paper is still available, free, at any time;
- the customer can withdraw this consent by telling the staff, or after leaving by writing to the venue's contact address.

The statement is shown in the receipt language, and its text is versioned. The venue's contact address does not exist yet: the build adds a contact email (and optional phone) to the location's settings, and Email is offered only once one is set.

The dialog follows the shared form rules ([design-system.md → Forms](../../developers/design-system.md#forms)): the required fields are marked, a mistake is explained beside the field, and Issue stays disabled until the fields are right. The server checks everything again.

**When Email is offered, and where it goes.**

- **A live venue** sends through its own SMTP server, which it sets up when it goes live ([below](#set-up-email-for-a-live-venue)). Email is offered once that server is set up and the location has a contact email.
- **A venue preparing to go live** sends invoice email through its SMTP server when one is set, and otherwise to the box's own captured inbox, the test mail gateway the owner named (decision 7). That is the rule account email already follows ([email-delivery.ts:15-33](../../../apps/server/src/email-delivery.ts#L15-L33)). Such an invoice can reach a real customer's address, so the PDF's practice warning ([below](#make-the-pdf)) is what tells the customer it is not a real invoice.
- **A demo** sends every invoice email to the captured inbox, **even if an SMTP server has been set up**. This is narrower than today's account email, which a demo also sends through SMTP when one is set.
- **A development server** captures every invoice email, in every mode and whether or not an SMTP server is set.

**Recorded with the sale.** These details go into the bill's invoice choice, with the same check A231 uses so that two tills cannot overwrite each other:

- the customer's email address;
- the consent statement's version and language;
- the time;
- the staff member.

At issue they go into a snapshot on the sale. If the customer withdraws before the email is sent, the delivery switches to paper. After it is sent, the original has been delivered, and a paper copy is a duplicate (asesor question 1).

**Sent from a queue.** The sale's own transaction writes an invoice-delivery row: the sale, the medium, the address, the status and the attempts. A background worker in the server then works in three steps:

1. It claims the row in one short transaction.
2. With no transaction open, it renders the PDF, stores it, and sends it with the PDF attached. The mail message type gains attachments.
3. It records the result in a second short transaction.

The worker retries a certain failure a bounded number of times with growing gaps; the plan fixes the numbers. A row the worker left mid-send when the box stopped becomes "outcome unknown", and every later send of that invoice is a duplicate. "Sent" means the mail server accepted the message. A later bounce is not seen, and the screens say "sent to …", never "received".

**When it fails.** The till's sale view and the dashboard's order detail show "Invoice not delivered" with three actions:

- send again, to the same or a corrected address;
- print on the receipt printer;
- print on the A4 printer.

Each of these is the original or a duplicate by the rule above. A final failure also raises an alert, so an undelivered invoice does not go unnoticed. For a consumer the original is due at issue (art. 18), so the till shows the result while the customer is still there. A send normally finishes in seconds, and the failure path offers paper on the spot.

**Practice mode.** A demo, and a venue preparing to go live with no SMTP server set, capture the email in the box's inbox (A227). The PDF must fit under the capture service's 1 MB limit. The build measures a long invoice's message size and raises the limit if needed.

## Set up email for a live venue

The owner: "when a restaurant goes live with waitron they need to have an smtp gateway set up. before that (eg in the demo) we can use our test mail gateway."

**Where.** Going live is the setup wizard's "live" path, which provisions a fresh database (above). The configuration carried over from a prepare venue holds no credentials, so a new live venue gets its mail server there. So:

- **The live setup gains an Email step**, just before the review screen. Today the live path goes from the venue details to the review, through the certificate and fiscal-test screens where they apply (common-territory Spain, not a development server: [setup-app.ts:637-642](../../../apps/setup/src/setup-app.ts#L637-L642), [cert-screen.ts:179](../../../apps/setup/src/screens/cert-screen.ts#L179), [fiscal-test-screen.ts:60](../../../apps/setup/src/screens/fiscal-test-screen.ts#L60)); the Email step comes after them, or straight after the venue details where they do not apply. It asks for the mail server's address and port, how the connection is encrypted (upgraded after connecting, called STARTTLS, usually port 587; or encrypted from the start, usually port 465), the user name and password if the server needs them, and the "from" address invoices are sent from.
- **A test message proves it.** The step's "Send test message" sends a short message to the admin's own address, through those settings, from the setup service. Continue stays disabled until the mail server has accepted one. "Accepted" means the mail server took the message; the screen asks the admin to check it arrived, but cannot know.
- **It travels like the certificate.** The settings go in the provision request beside `aeatCert`, and the server seals them as the existing `email.smtp` credential (its `url` and `from` fields) in the same provisioning step. An SMTP address can carry a password, so the settings are never logged, never echoed back, and never shown again: the screen shows the server and the "from" address only.
- **Required for a live venue.** A live provision without email settings is refused with a named code. A development server (`WAITRON_ENV=dev`) may skip the step, because it captures invoice email anyway.

**Changing it later.** The dashboard gains an Email settings card: the server and "from" address as set (never the password), "Change" (the same fields and the same test message), for a manager — the `system.manage` permission, which managers already hold for backups ([backup-api.ts:205](../../../apps/server/src/backup-api.ts#L205)). It seals the credential the way the payments connection does. In a venue preparing to go live or a demo it offers no change, and says where invoice email goes: in a prepare venue, through the mail server if one is set, otherwise captured on the box; in a demo, always captured on the box. Setting a mail server there is the open backlog item below: today it takes the terminal command, and once set it carries the venue's account email (invitations and password resets) too, which is that item's business, not this design's.

**A live venue without email.** A venue set up live before this build has no SMTP server. A live venue rebuilt by a restore may have none either: the credential is sealed with the machine's own key (the credentials table is classified `local`, [classification.ts:3-13](../../../packages/credentials/src/classification.ts#L3-L13)). That file states that a rebuild from the bucket brings the same machine's key back with it; the other restore paths were not checked here, and the build checks each one (plan task 3). In either case the F1 dialog does not offer Email, and the Email settings card says invoices cannot be emailed until a mail server is set up, with the same Change action. Account email in such a venue stays unsent, as today.

**The open backlog item.** The backlog's "A venue preparing to go live sends real email through SMTP" (owner, 2026-10-03, A227's follow-up) stays open (decision 7). This design only follows whatever that item, or the terminal command, sets: a prepare venue's invoice email goes through its mail server when one is set. It adds no way to set one there. A mail server set up while preparing does not carry into the live venue, which sets its own in the setup wizard.

## Print it on an office printer

**Any office printer on the venue's network, added where receipt printers are added.** The owner: "if the user has an A4 printer available we should try to use it." So an office printer is an invoice printer, added through the Printers screen's existing add-printer dialog: the same Scan, the same discovered list, the same name field. Only the action differs.

- **Finding it.** The agent keeps today's two ways of finding printers and adds a third: it also asks the network for printers announcing IPP (`_ipp._tcp`), which IPP Everywhere requires of every printer that announces itself over mDNS ([register](#printing-standards-checked-2026-10-03)), so a printer whose raw port is switched off is still found.
  - A printer found this way is a new kind of discovered device, an IPP printer, carrying the port and the resource path its announcement gives: IPP Everywhere requires the path in the announcement's `rp` entry and only recommends `/ipp/print` (v1.1, printed lines 627 and 913–914). Today's check always asks port 631 at `/ipp/print` ([ipp-probe.ts:19](../../../apps/print-agent/src/ipp-probe.ts#L19)), and today's announcement reader turns every record into a raw-port device ([network.ts:103-155](../../../apps/print-agent/src/network.ts#L103-L155)); neither may be reused unchanged.
  - An IPP printer is never offered as a receipt printer, even when its check fails. It is merged with a raw-port record for the same host, so one printer appears once.
  - A printer that announces only the encrypted IPP service (`_ipps._tcp`) is not found in this build.
- **Asking it.** Each office printer found is asked, as today, one read-only Get-Printer-Attributes question, at its own port and path, which now names `document-format-supported`, `media-supported` and the raster attributes (`urf-supported`, `pwg-raster-document-resolution-supported`, `pwg-raster-document-type-supported`) as well.
- **In the dialog.** An office printer that takes A4 or US letter and a format Waitron can send ([below](#what-office-printers-accept)) shows "Add as invoice printer" where a receipt printer shows Add. One that takes none of those formats stays greyed, with the reason in place of today's "not supported for receipts": "This printer does not accept a format Waitron can print." A receipt printer's row is unchanged.
- **On the Printers tab.** An invoice printer is listed with the receipt printers, marked "Invoice printer (A4)", with the row menu's rename and disable (a disabled one stays re-addable from the dialog's "Add again", as receipt printers do, [CLAUDE.md §3](../../../CLAUDE.md); 2026-10-05: printers now say Enable there, since W105a), and a "Print test page" that prints one A4 page through the same path an invoice takes. Adding, renaming, disabling and the test page need `printer.manage`, as receipt printers do.
- **Not in this build.** A USB office printer plugged into the box, and a printer the agent cannot find on its own network. The agent's USB path writes a receipt printer's own commands to the device, which an office printer does not speak; driving one over USB needs IPP over USB, which is separate work.

### What office printers accept

The owner asked: "do most modern printers accept PDFs directly? if so then we should add them as invoice printers… otherwise we look for some other solution."

**No standard promises PDF.** The three programmes a modern office printer is certified under say this (exact words in the [register](#printing-standards-checked-2026-10-03)):

- **IPP Everywhere** (the printing industry's standard for printing with no driver). Version 1.0 (2013) required PDF of printers on the newer IPP versions. Version 1.1 (2020), the current one, requires **PWG Raster** of every printer and only recommends PDF. The draft version 2.0 (April 2026) keeps PDF recommended for a physical printer. JPEG is required only of colour printers.
- **AirPrint** (Apple). No Apple-published list of required formats was found, on Apple's support and developer pages or in its Bonjour printing specification. The one example found, a made-up "Acme Printer" in Apple's 2016 slides on AirPrint in companies, announces Apple Raster (URF) and JPEG and no PDF, on the encrypted IPP service. That illustrates an announcement; it is not a requirement.
- **Mopria** (the Android equivalent). Its print specification is for members only. A public Mopria post says the specification "supports the use of PDF, PCLm, and pwg-raster", which says what it allows, not what a printer must take.

How many printers take PDF in practice was not found: the IPP Everywhere certified-printer list records no formats. CUPS, the printing system on Linux and macOS, sends PDF first when a printer lists it, and falls back to a raster otherwise (read in its source code, and seen with stand-in printers, [below](#debians-printing-system-cups-instead-of-drawing-pages-ourselves), where Debian 13's CUPS also refused to set up a printer taking only PWG Raster). The one office printer measured here takes PDF.

**So Waitron sends what each printer says it takes, PDF first.** When an invoice printer is added, its `document-format-supported` list is read and one format is chosen and stored:

1. **PDF** (`application/pdf`), when listed. The stored PDF is sent as it is.
2. **Otherwise PWG Raster** (`image/pwg-raster`), which every IPP Everywhere printer must take. Its format is a published standard (PWG 5102.4).
3. **Otherwise Apple Raster** (`image/urf`), the format Apple's AirPrint example announces; the measured HP takes it and not PWG Raster. Apple publishes no specification for it; CUPS's own raster library writes it (its `CUPS_RASTER_WRITE_APPLE` mode, beside the PWG one), and the build takes that code as the reference. If any CUPS code is copied or ported, its Apache 2.0 notice ships in `/app/third-party/` ([CLAUDE.md §3](../../../CLAUDE.md)).
4. **Otherwise the printer is not offered**, with the reason in the dialog. JPEG is not used: version 1.1 does not require it of black-and-white printers, and PWG Raster, which it does require of every printer, reaches every IPP Everywhere printer. PCLm is not used either: no published requirement read here asks for it. A printer that takes only PCLm, or only its maker's own languages (PCL, PostScript), is not offered; such a venue emails the invoice or prints it on the receipt printer.

The choice is read from `document-format-supported`, never from the device id string, because the measured HP's device id names a PWG raster language that its format list does not offer (above).

**How a raster page is made.** The server draws the same F1 layout the PDF draws, as dots:

- The layout is drawn as an SVG picture (a text description of shapes, which an image library can turn into dots), with each letter turned into its outline from the same bundled font the PDF embeds, so drawing needs no installed fonts.
- `sharp`, already in the box image, turns the SVG into a grey picture at a resolution the printer lists: 300 dots per inch where offered, otherwise the lowest it offers. The measured HP offers Apple Raster at 600 only, a 35 MB page of grey dots before packing. Both resolutions were measured working for a page of shapes (above); the build measures a page of real text, at both, on the box itself.
- The QR keeps its legal size on paper: 35 mm is 413 dots at 300 per inch and 827 at 600, drawn at level M from the same matrix the PDF uses.
- The server packs the picture into PWG Raster or Apple Raster and the agent sends those bytes. The agent stays a transport that knows nothing about invoices; it imports no other package in this repo ([CLAUDE.md §3](../../../CLAUDE.md)).
- If drawing text as outlines through `sharp` proves unworkable, the fallback is the printing package's own bitmap font, drawn at twice its size. The build's first task decides, and says which.

**Keep page printers and their jobs apart from the receipt-printer tables.** Two reasons:

1. Fitting an office printer into `printers` would change its fixed lists, which on this database means rebuilding the table. Six other tables point at it, and a rebuild deletes or refuses their rows ([CLAUDE.md §3](../../../CLAUDE.md)).
2. The print-job queue delivers "at least once", and resends finished jobs. That is right for a kitchen ticket and wrong for an invoice original.

So, instead:

- **A new page-printer table** holds each office printer: its location, name, IPP address, paper size, the format chosen for it, and the format list it reported when added.
- **The invoice-delivery row is the A4 job.** It names the page printer and the stored PDF, and its own states carry the outcome.
- **The agent claims deliveries for its location.** A delivery whose claim lapses becomes "outcome unknown"; it is not re-sent.
- **A page printer can never take a receipt, a kitchen ticket or a cash-drawer pulse**, because it is not in the table those jobs point at. Likewise, a receipt printer can never take an A4 invoice.

**Which printer.** The Printing rules screen gains one setting per location: "Invoice printer (A4)", choosing from that location's page printers, or none. The till and the dashboard print A4 invoices there. With none set, A4 is not offered.

**How it travels.** The agent fetches the claimed delivery's document — the stored PDF, or the raster pages the server drew from the same layout in the printer's chosen format — and sends it to the printer with one IPP Print-Job request (`document-format` set to that format, A4 or the printer's letter size). It then asks Get-Job-Attributes until the printer reports the job completed, aborted or cancelled, or a time limit passes, and reports what it saw.

**When paper or the printer fails.** The printer may refuse the job, abort or cancel it, or not answer, or the time limit may pass. In each case the delivery is marked failed, or "outcome unknown" when pages may have printed. Where the printer gives a reason, such as "out of paper", it is recorded as a code. The F1 then shows "Invoice not delivered" with the ways to deliver it.

What this printer reports when its tray is empty or a sheet jams is not known yet. The build measures it on the owner's HP and writes the result down.

### Debian's printing system (CUPS) instead of drawing pages ourselves?

The owner asked: "can we install IPP everywhere as part of debian? does that immediately give us compatibility with most printers, or do we still need to choose drivers?" The alternative to drawing raster pages on the server is to install Debian's own printing system in the print agent's image and let it convert:

- `cups`, the print server, which queues jobs and sends them to printers;
- `cups-filters`, the converters that turn a PDF into what a printer takes;
- `ipp-usb`, which makes a USB printer that speaks IPP over USB look like a network printer;
- `cups-browsed`, which finds network printers and makes a queue for each by itself. The agent would add each queue itself, so this one would be left out.

A **driverless** printer is one that says what it takes when asked over IPP, so the computer needs no maker's driver for it. The agent would add each invoice printer to CUPS with `lpadmin -m everywhere`, which asks the printer, and would always hand CUPS the PDF to convert.

**Measured on 2026-10-03, on the owner's Mac.** Docker 29.3.0 on arm64, with `node:26-slim`, which is Debian 13, and Debian's CUPS 2.4.10-3+deb13u2 and cups-filters 1.28.17-6+deb13u1. The stand-in printers were CUPS's own software printer, `ippeveprinter`, each started with `-f` naming the only formats it takes. The Dockerfiles, scripts and output are in `~/waitron-campaign-c/a231d-cups/` on that Mac, which is not a lasting receipt.

- **Size.** A copy of the print agent image's packages (`node:26-slim` plus `python3-minimal` and `bluez`, as [deploy/Dockerfile](../../../deploy/Dockerfile) installs them) is 106.4 MB to download (`docker image inspect --format '{{.Size}}'`, which for `node:26-slim` was within 12 kB of the sum of its published arm64 layers). With the four packages above and `cups-ipp-utils` (which `cups` brings anyway, and which holds `ippeveprinter`) installed the way the Dockerfile installs everything, `apt-get install --no-install-recommends`, it was 159.1 MB:
  - **52.7 MB more to download, about half as much again**;
  - 117 more Debian packages, together about 148 MiB installed (the sum of their `Installed-Size`).
  - `cups` on its own, without `ipp-usb` and `cups-browsed`, was 156.2 MB and 111 packages: it requires `cups-filters`, `ghostscript` and `poppler-utils` (its `Depends:` line), so nearly all of the cost comes with it.
  - With Debian's recommended extras as well, 212.6 MB and 219 packages.
  - `ipp-usb` on its own added 3.0 MB and 8 packages: itself, Avahi's daemon and libraries, `libdaemon0` and `libusb`.
- **It converted for an Apple Raster printer.** A stand-in taking only Apple Raster and JPEG was set up with `-m everywhere`, and a one-page PDF printed to it arrived as Apple Raster: the kept file began `UNIRAST`. A stand-in taking PDF and PWG Raster was sent a PDF (CUPS passed it through its own PDF filter, so the bytes differed: 3,173 sent, 3,306 kept).
- **Its own driverless setup refused a printer that takes only PWG Raster; a deprecated route printed to it.** A stand-in taking `image/pwg-raster` and JPEG, and reporting `pwg-raster-document-resolution-supported = 300dpi,600dpi` and `pwg-raster-document-type-supported = black_1,sgray_8`, was refused by `lpadmin -m everywhere`: «lpadmin: Unable to create PPD: Printer does not support required IPP attributes or document formats.» That matches a mistake in CUPS 2.4.10's check, which looks for the printer's list of resolutions under the wrong type of value; upstream fixed it in 2.4.12 ([register](#printing-standards-checked-2026-10-03)), and Debian's next release, still in testing, has CUPS 2.4.18-1, whose `lpadmin -m everywhere` accepted the same stand-in. The failed `lpadmin` also left a queue behind, which accepted a PDF job and then reported it `completed` («job-completed-successfully»), though nothing reached the printer; the only sign was the message «Unable to add document to print job.» The same printer could be set up another way, found by the review: cups-filters' own `driverless` tool wrote a printer description for it, and `lpadmin -P` with that file printed «lpadmin: Printer drivers are deprecated and will stop working in a future version of CUPS.», then printed the PDF as PWG Raster (the kept file began `RaS2`).
- **It held a job while the printer was away, and printed it later by itself.** With the Apple Raster stand-in stopped, a job sat "printing", with «The printer may not exist or is unavailable at this time.», for the 45 seconds it was watched. Once the stand-in was started again, CUPS printed the job on its own, 54 seconds after it was sent. The wait comes from CUPS's IPP sender itself, which keeps reconnecting for up to 7 days by default (its `contimeout` setting, read in its source, [register](#printing-standards-checked-2026-10-03)); the job had not failed, so the error policy in CUPS's settings never applied.
- **It ran as the agent's own user, and without D-Bus.** D-Bus is the message channel Linux services talk to each other over. `cupsd` ran as the `node` user, the agent's own, on a port above 1024 with its own folders; it set up a driverless queue and printed. In a separate container with neither D-Bus nor Avahi running, `cupsd` set up a queue by IP address and printed. `ippeveprinter` itself would not start without Avahi («Unable to initialize DNS-SD.»), which is why the stand-ins ran with it.
- **Generic drivers exist for printers with no driverless format.** `lpinfo -m` listed "Generic PCL Laser Printer" and "Generic PostScript Printer". Setting up a queue with one printed the same deprecation message. Neither was tried on a real printer.

Not measured: anything on the box itself (its processor, an x86 build, its AppArmor), a real office printer through CUPS, a USB printer, and what CUPS reports when a real printer runs out of paper.

**Point by point.**

| | This design: pages drawn by the server | Debian's CUPS in the agent's image |
| --- | --- | --- |
| Image size | No new package. `sharp` is already in the server's image, and the agent only sends bytes. | 52.7 MB more to download, 117 packages (measured). |
| Licence notices | CUPS's Apache 2.0 notice, if its raster code is ported. | Each added package's copyright file in `/app/third-party/`, as `python3-minimal`'s are shipped today. They include Ghostscript, which `cups-filters` requires and whose copyright file names the GNU Affero GPL, version 3 or later ([register](#printing-standards-checked-2026-10-03)). What shipping it beside Waitron obliges is a licensing question, not settled here. |
| AppArmor profile ([deploy/apparmor/waitron-print-agent](../../../deploy/apparmor/waitron-print-agent)) | No change. | `cupsd` and its converters need no new file or network rule: the profile allows all files and all networking (`file,` and `network,`), read, not run under AppArmor. `ipp-usb`'s README lists a running Avahi; that means a second Avahi inside a container that shares the box's network, or the box's own reached through new D-Bus rules. Neither was measured, and whether `ipp-usb`'s `dns-sd = disable` setting removes the need was not tried with a printer. |
| PDF printers | The PDF, as it is. | A PDF (measured). |
| Apple Raster printers | Our Apple Raster encoder. | Converted by CUPS (measured). |
| PWG Raster printers with no PDF and no Apple Raster | Our PWG Raster encoder. | Refused by `-m everywhere` in Debian 13's CUPS 2.4.10, and printed through cups-filters' `driverless` description, a route CUPS calls deprecated (both measured). Accepted by `-m everywhere` in Debian testing's CUPS 2.4.18-1 (measured). |
| PCL- or PostScript-only printers | Not offered (decision 9). | Generic drivers CUPS calls deprecated; not tried on a real printer. |
| USB office printers | Not in this build. | `ipp-usb`: 3.0 MB on its own, BSD-2-clause. It reaches the printer through `libusb`, not through the USB printer devices (`/dev/usb/lpN`) that compose lets the agent open today; which access it needs was not measured. It does not need CUPS: its shipped settings serve the printer as an IPP printer on an address only the box itself can reach, from port 60000 up, which the agent's own IPP client could in principle print to (not tried). |
| Code Waitron would own | Drawing the page as dots, two raster encoders, and an IPP Print-Job and Get-Job-Attributes client. | Starting and watching `cupsd` inside the agent's container, whose main program is Node. Creating, changing and removing a CUPS queue for each invoice printer, with a printer description written by the deprecated route for PWG-Raster-only printers. An IPP client anyway, to hand jobs to CUPS and read their states. Keeping CUPS's settings in the agent's state volume. The server no longer draws pages as dots. |
| What the dashboard can be told | The printer's own answer to the agent: refused, aborted, completed, or no answer. | CUPS accepted the job at once and kept trying to reach the printer (measured for 45 seconds). Its source code waits 7 days before counting such a job failed, and Debian's settings then retry it (read, not run). Keeping the design's rule — only a job the printer refused before printing may be retried as the original — needs the agent to shorten that wait (`contimeout`) or cancel the job at its own deadline, and to read the printer's reasons through CUPS. A job CUPS was holding when cancelled is "outcome unknown". |

**Recommendation: keep drawing pages ourselves, and do not add CUPS in this build.**

1. It adds about half again to the agent's download and brings Ghostscript's licence, for printers this design reaches without it.
2. On Debian 13, its own driverless setup refuses printers that take only PWG Raster, the format every IPP Everywhere printer must take. They can be reached through a route CUPS says will stop working.
3. Its own queue would sit between the agent and the printer, holding a job until the printer comes back, and in one test reporting a job completed that never reached the printer. That is the "at least once" behaviour, and the uncertain outcome, this design keeps invoices away from in Waitron's own print queue.
4. What it would save — the page drawn as dots and two encoders — is bounded work that can be tested against `ippeveprinter` and CUPS's own raster reader (plan task 1).

So, to the owner's question: on Debian 13, installing CUPS prints with no driver chosen to printers that take PDF or Apple Raster. Printers that take only PWG Raster need a printer description made by a route CUPS calls deprecated, until Debian 13 gets CUPS 2.4.12 or later. Printers with no driverless format still need a driver, which CUPS also calls deprecated. Revisit CUPS if PCL- or PostScript-only printers are wanted, because those need a driver and our own path has none. For USB office printers, the candidate is `ipp-usb` on its own, not the whole of CUPS.

## Send or print it again later

- **On the till**, the issued sale's view gains "Invoice" actions: print on the receipt printer (A231's reprint), print on A4, and email. An email asks for an address and the same consent if none is recorded for this sale.
- **On the dashboard**, the order detail dialog already has Reprint ([order-detail-dialog.ts:163](../../../apps/dashboard/src/widgets/order-detail-dialog.ts#L163)). For an F1 it gains "Print on A4", "Email to customer" and "Download PDF". Each records who did it and when, as receipt copies already do.
- **Download gives a copy marked «duplicado».** Handing out an unmarked file would let a second original exist. The downloaded file is stored like any other duplicate.

Only managers may email or download an invoice from the dashboard (decision 4), because either action sends or hands over a customer's tax ID and address. Today any dashboard session — unless it runs on an enrolled device whose profile lacks receipt printing ([orders-api.ts:197](../../../apps/server/src/orders-api.ts#L197)) — may reprint a receipt from the current business day, and `report.view`, which supervisors hold too, widens that to older orders ([orders-api.ts:110-118, 199-210](../../../apps/server/src/orders-api.ts#L110-L118)). Email and download instead need `report.export`, which managers and admins hold and supervisors do not ([permissions.ts](../../../packages/identity/src/permissions.ts)), for any order.

## What the owner decides

Decisions 1–9 are answered ([above](#owner-decisions-2026-10-03)). One new one:

10. **Draw pages ourselves, not through CUPS.** Recommended: the server draws a page as dots for a printer that takes no PDF, and the print agent sends it with its own IPP client, as this design says; CUPS is not added to the agent's image ([the comparison](#debians-printing-system-cups-instead-of-drawing-pages-ourselves)). The alternative is to install CUPS in the agent's image and hand it every invoice as a PDF: no page drawing on the server, but 52.7 MB more to download, Ghostscript's licence, printers that take only PWG Raster reachable on Debian 13 only through a route CUPS calls deprecated, and its own queue to tame, which kept a job waiting while a printer was away and, on a queue a failed setup left behind, reported a job completed that never reached the printer. If you choose CUPS, plan tasks 1 and 5 are rewritten before the build starts.

## Questions for the asesor

1. Each F1 has one original (art. 14.1). If the original is handed over on paper, may Waitron also email a PDF at the customer's request? If so, is that PDF a «duplicado» (art. 14.2 lists only several recipients or loss), or something else, and how is it marked? If the original was emailed and the customer then asks for paper, is the paper a «duplicado»?
2. Is a consent box ticked on the till's screen, by staff at the customer's request, enough as "consentimiento expreso" under art. 63.3? Or must the customer give it themselves, for example by signing or by confirming from their own email? Is withdrawal "by telling the staff, or by writing to the venue" enough?
3. Art. 21.1 asks for a sent invoice to be kept "en el formato original en el que se hayan … remitido". Is storing the exact PDF bytes, with their fingerprint, enough? For how long: the four years of Ley 58/2003 art. 66, or longer?
4. For a business customer before RD 238/2026 applies: is an unsigned PDF by email, with this consent, a valid delivery of the original? Is art. 8.4's presumption for compliant billing software enough proof of origin and integrity, or should the PDF carry an advanced electronic signature? Do the 30–40 mm QR and the legend apply to the PDF exactly as on paper? AEAT's FAQ says they do.
5. If an email is refused by the mail server, or the printer refuses a job before printing, is the next attempt still the original? If an email was accepted by the mail server but the customer says it never arrived, or the box cannot tell whether an email or a print went out, is the next one a «duplicado» for loss of the original (art. 14.2.b), with art. 14.3's equal effect? And if the receipt printer's queue prints an F1 twice after a lapsed claim, what should the venue do with the second sheet?
