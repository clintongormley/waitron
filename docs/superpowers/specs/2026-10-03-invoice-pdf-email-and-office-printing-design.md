# Full invoices by email as a PDF, and on an office printer (A231d)

**Status:** proposal for owner approval, 2026-10-03. Nothing here is built. The build is queued only after the owner approves this design, and it follows the A231 build, which it depends on.

## What this adds, and what it builds on

The [A231 design](2026-10-03-full-invoices-at-till-design.md) lets the till issue a full invoice (an F1, which names the customer) and prints it on the receipt printer. It left two ways of delivering that invoice for later ("Email PDF" and "A4 office printer" in its table "Deliver a readable F1"). The owner asked for both on 2026-10-03: "we should also email a pdf to the customer and have a way of printing it to a normal printer".

This design covers:

1. Turning a filed F1 into a PDF.
2. Emailing that PDF to the customer, with the consent the law asks for.
3. Printing it on an ordinary A4 office printer through the print agent (the small program on the box that sends jobs to printers).
4. Sending or printing it again later, from the till and from the dashboard.

It covers full invoices (F1) only. A simplified invoice (F2, the ordinary till receipt) by email is not asked for and is not designed here.

Everything below reads the F1 facts the A231 build will store at issue: the customer's tax ID, legal name and address, the taxpayer's domicile, the net line figures and the VAT breakdown. None of it exists until the A231 build lands.

Two sentences in A231's design change with this one:

- Its table says "A PDF email alone is not the selected delivery guarantee". With the consent below, an emailed PDF becomes a valid way to deliver the original.
- Its "F1 not delivered" state becomes one of this design's delivery records, rather than a second mechanism beside them.

Terms used below:

- **The asesor** is the venue's tax adviser.
- **SMTP** is the standard way one computer hands email to a mail server.
- **IPP** is the standard office printing protocol, spoken on network port 631.
- **An append-only table** is one whose rows the database refuses to change or delete once written.

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

## Measured on 2026-10-03

The owner's office printer was asked, read-only, which document types it accepts. The command was `ipptool -t ipp://NPIDE0887.local:631/ipp/print` with one Get-Printer-Attributes request (IPP's "tell me about yourself" question). It reported:

- `printer-make-and-model = HP ColorLaserJet MFP M178-M181`;
- `ipp-versions-supported = 1.0,1.1,2.0`;
- `operations-supported` including `Print-Job` and `Get-Job-Attributes`;
- `document-format-supported` including `application/pdf`;
- `media-supported` including `iso_a4_210x297mm`.

The fresh-context review repeated the query and got the same answer. The second office printer the Mac knows (an HP M282nw) did not answer, so this is one printer. The raw reply bytes were not saved.

## What the code does today

- **Email.**
  - There is one kind of email: account email (invitations, password resets and email changes). Nodemailer sends it inline, while the request waits ([account-email.ts:77](../../../apps/server/src/account-email.ts#L77)).
  - The message type has no attachments ([account-email.ts:18-25](../../../apps/server/src/account-email.ts#L18-L25)), and there is no queue or retry.
  - A failure is logged as `account_email.send_failed` without the error, because an SMTP address can contain a password ([management-api.ts:191-197](../../../apps/server/src/management-api.ts#L191-L197)).
  - Mail goes through SMTP when the `email.smtp` credential is set. Otherwise, in a demo or a venue preparing to go live, the box captures it in its own inbox, and in a live venue it is not sent at all ([email-delivery.ts:15-33](../../../apps/server/src/email-delivery.ts#L15-L33)).
  - The credential can only be set with the `waitron-credentials set --purpose email.smtp` command ([apps/server/README.md:303](../../../apps/server/README.md#L303)), which needs a terminal on the box.
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
  - The print agent finds them and greys them out. It asks a printer's IPP service only for `media-supported` ([ipp-probe.ts:49](../../../apps/print-agent/src/ipp-probe.ts#L49)), and the dashboard shows "Office printer — not supported for receipts" instead of Add ([strings.ts:950](../../../apps/dashboard/src/i18n/strings.ts#L950), chosen at [printers-screen.ts:1069-1072](../../../apps/dashboard/src/screens/printers-screen.ts#L1069-L1072)).
  - A printer row is `usb`, `network_tcp`, `bluetooth` or `cloud_poll`, with a 58 or 80 mm roll. Database checks hold each of those lists ([printers.ts:55-65](../../../packages/db/src/schema/printers.ts#L55-L65)).
  - Six tables point at `printers`: `devices`, `tills`, `drawer_opens`, `station_printers`, `watcher_printers` and `print_jobs`.
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

**One layout model, two outputs.** The A231 build will lay out the paper F1 for the receipt printer. Build it, or reshape it in this build's first task, as a format-neutral F1 document: sections, lines, totals, the QR text and the legend, all read from the stored F1 facts. Then the roll printer and the PDF draw the same thing, and a reprint, the paper copy and the PDF can never disagree about a figure.

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

**Keep the exact file that was delivered.** Waitron keeps its invoices electronically, so art. 21.1 asks for a sent invoice to be kept in the format it was sent in. Each PDF that is emailed or printed on A4, as an original or a duplicate, is stored once in an append-only table, with its SHA-256 fingerprint and the sale it belongs to.

The database streams to the owner's bucket, so the bucket holds these files. After A231 it will also hold the same customer name, tax ID and address in the sale row. F1s are rare in a restaurant, but the build measures a realistic file's size and records it.

## Email it

**At issue, in A231's full-invoice dialog.** The dialog gains a delivery choice: "Printed receipt" (default), "A4 printer" (only when the venue has an invoice printer, below) and "Email".

Choosing Email shows an email address field and a consent box, unticked by default. Next to the box, a short statement says:

- the invoice will be sent as a PDF to this address instead of on paper;
- paper is still available, free, at any time;
- the customer can withdraw this consent by telling the staff, or after leaving by writing to the venue's contact address.

The statement is shown in the receipt language, and its text is versioned. The venue's contact address does not exist yet: the build adds a contact email (and optional phone) to the location's settings, and Email is offered only once one is set.

The dialog follows the shared form rules ([design-system.md → Forms](../../developers/design-system.md#forms)): the required fields are marked, a mistake is explained beside the field, and Issue stays disabled until the fields are right. The server checks everything again.

**When Email is offered.** Email is offered when the box can send mail:

- SMTP is set up, in any kind of venue;
- or the box is in practice mode, where it captures mail in its own inbox.

Today a live venue can only set up SMTP with the terminal command above, which a box operator does not have. Adding a dashboard SMTP setting is the open backlog item "A venue preparing to go live sends real email through SMTP". This design does not build it.

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

**Practice mode.** A demo or a venue preparing to go live captures the email in the box's inbox (A227). The PDF must fit under the capture service's 1 MB limit. The build measures a long invoice's message size and raises the limit if needed.

## Print it on an office printer

**Office printers are registered separately, for invoices only.** A page printer the agent finds is offered as "Add as invoice printer" instead of being greyed out. Registration asks the printer, with one Get-Printer-Attributes request like the one the agent already sends, for `document-format-supported` and `media-supported`.

The first build accepts a printer only if it takes PDF (`application/pdf`) and A4 or US letter. The owner's HP does (measured above). A printer that takes only image formats is refused with a named reason. Sending images instead of a PDF is later work, if a venue needs it.

**Keep page printers and their jobs apart from the receipt-printer tables.** Two reasons:

1. Fitting an office printer into `printers` would change its fixed lists, which on this database means rebuilding the table. Six other tables point at it, and a rebuild deletes or refuses their rows ([CLAUDE.md §3](../../../CLAUDE.md)).
2. The print-job queue delivers "at least once", and resends finished jobs. That is right for a kitchen ticket and wrong for an invoice original.

So, instead:

- **A new page-printer table** holds each office printer: its location, name, IPP address and paper size.
- **The invoice-delivery row is the A4 job.** It names the page printer and the stored PDF, and its own states carry the outcome.
- **The agent claims deliveries for its location.** A delivery whose claim lapses becomes "outcome unknown"; it is not re-sent.
- **A page printer can never take a receipt, a kitchen ticket or a cash-drawer pulse**, because it is not in the table those jobs point at. Likewise, a receipt printer can never take an A4 invoice.

**Which printer.** The Printing rules screen gains one setting per location: "Invoice printer (A4)", choosing from that location's page printers, or none. The till and the dashboard print A4 invoices there. With none set, A4 is not offered.

**How it travels.** The agent fetches the claimed delivery's PDF and sends it to the printer with an IPP Print-Job request (`document-format = application/pdf`, A4). It then asks Get-Job-Attributes until the printer reports the job completed, aborted or cancelled, or a time limit passes, and reports what it saw.

**When paper or the printer fails.** The printer may refuse the job, abort or cancel it, or not answer, or the time limit may pass. In each case the delivery is marked failed, or "outcome unknown" when pages may have printed. Where the printer gives a reason, such as "out of paper", it is recorded as a code. The F1 then shows "Invoice not delivered" with the ways to deliver it.

What this printer reports when its tray is empty or a sheet jams is not known yet. The build measures it on the owner's HP and writes the result down.

## Send or print it again later

- **On the till**, the issued sale's view gains "Invoice" actions: print on the receipt printer (A231's reprint), print on A4, and email. An email asks for an address and the same consent if none is recorded for this sale.
- **On the dashboard**, the order detail dialog already has Reprint ([order-detail-dialog.ts:163](../../../apps/dashboard/src/widgets/order-detail-dialog.ts#L163)). For an F1 it gains "Print on A4", "Email to customer" and "Download PDF". Each records who did it and when, as receipt copies already do.
- **Download gives a copy marked «duplicado».** Handing out an unmarked file would let a second original exist. The downloaded file is stored like any other duplicate.

Who may email or download an invoice from the dashboard is the owner's choice (decision 4 below). Either action sends or hands over a customer's tax ID and address.

## What the owner decides

1. Approve "one original, chosen at issue", the "at most one attempt at the original" rule, and that the first build sends no courtesy PDF alongside a paper original.
2. Approve the consent statement's content (above), and adding a venue contact email to the location settings as the way to withdraw after leaving. The exact wording comes in the build for review.
3. Approve storing every delivered PDF in the database, and therefore in the bucket.
4. Who may email or download an invoice from the dashboard: the same people who may reprint a receipt there today, or only managers.
5. Approve `pdfkit` (a JavaScript PDF library that wraps text and embeds fonts, so the box needs no browser), and a font, subject to the build's first-task checks.
6. The order of work. This build needs A231's build. Email in a live venue also needs SMTP set up, which today takes a terminal. A4 printing needs neither, so it could ship first.

## Questions for the asesor

1. Each F1 has one original (art. 14.1). If the original is handed over on paper, may Waitron also email a PDF at the customer's request? If so, is that PDF a «duplicado» (art. 14.2 lists only several recipients or loss), or something else, and how is it marked? If the original was emailed and the customer then asks for paper, is the paper a «duplicado»?
2. Is a consent box ticked on the till's screen, by staff at the customer's request, enough as "consentimiento expreso" under art. 63.3? Or must the customer give it themselves, for example by signing or by confirming from their own email? Is withdrawal "by telling the staff, or by writing to the venue" enough?
3. Art. 21.1 asks for a sent invoice to be kept "en el formato original en el que se hayan … remitido". Is storing the exact PDF bytes, with their fingerprint, enough? For how long: the four years of Ley 58/2003 art. 66, or longer?
4. For a business customer before RD 238/2026 applies: is an unsigned PDF by email, with this consent, a valid delivery of the original? Is art. 8.4's presumption for compliant billing software enough proof of origin and integrity, or should the PDF carry an advanced electronic signature? Do the 30–40 mm QR and the legend apply to the PDF exactly as on paper? AEAT's FAQ says they do.
5. If an email is refused by the mail server, or the printer refuses a job before printing, is the next attempt still the original? If an email was accepted by the mail server but the customer says it never arrived, or the box cannot tell whether an email or a print went out, is the next one a «duplicado» for loss of the original (art. 14.2.b), with art. 14.3's equal effect? And if the receipt printer's queue prints an F1 twice after a lapsed claim, what should the venue do with the second sheet?
