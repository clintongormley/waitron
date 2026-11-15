# Adviser meeting, Thursday 19 November 2026

Written 15 November 2026 for the owner. Nothing here has been sent.

**How to use it.** Part 1 is in English, for you. Part 2 asks the same questions in Spanish, for the
tax adviser, and can be printed on its own. Each question says what Waitron does and why, then asks
for a yes or a correction. The first two need the adviser's judgement; the rest are confirmations,
ordered by what is filed or signed from the first day of trading.

**What the adviser already has.** S1 to S19 and R1 to R6, the
[shortened list](asesor-questions.md#the-shortened-list-2026-10-09), went to him around 15 October
(the owner's estimate). **He answered S1 to S16 and R1 to R6 on 15 November**, in a draft whose
numbers 1.1 to 1.16 and 2.1 to 2.6 are ours. What they change is in
[2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md). Questions 3 and 4 were rewritten
that day as follow-ups to his answers, and questions 15 to 21 were added; question 22 chases S17 to
S19, which he has not answered.

**Where the questions come from.** The [6 November list](2026-11-06-adviser-questions.md), whose
T numbers are given in brackets, cut to what is still open on 15 November, plus the questions the
owner's decisions of 14 and 15 November call for. What was dropped, and why, is at the end. The
reasoning and the full sources are in the 6 November list and the research files it links.

**How the Spanish quotations were checked.** Each quotation of a law, ruling or FAQ was matched word
for word, by a script, against text downloaded on 15 November 2026: the BOE's consolidated texts of
Ley 37/1992 (the VAT law, LIVA), RD 1619/2012 (the invoicing regulation) and Orden HAC/1177/2024;
DGT rulings V2884-16, V1665-22, V0902-22, V1924-23 and V2611-24 from the DGT's PETETE database; and
AEAT's developer FAQ v1.3, the PDF kept in [sources/](sources/). As a control, the date rulings'
phrase «deberá constar en serie específica de factura» was confirmed absent from V2884-16. The
downloads are not committed; fetch them again from those sites to re-check. The annex is copied
from the repository's declaration template, not from a law. The rewrite of 15 November (questions
3, 4 and 15 to 22) adds no quotation of a law or ruling: the one in question 4 is from the checked
set, the words in « » in questions 15 and 16 are ours, and the "where applicable" in question 19
is the adviser's own English.

## Part 1: English (for the owner)

### Tax and accounting

#### Needs the adviser's judgement

**1. One price for a takeaway set menu (T17).** Eaten at the venue and served by its staff, a set
menu is one restaurant service at 10%, drinks included (LIVA 91.Uno.2.2.º). Taken away or
delivered, it is a sale of goods and each part takes its own rate: food 10%, a sugared cola 21%
(LIVA 91.Uno.1.1.º; DGT V2949-16). Example: a €12.00 takeaway menu of a burger (€9.50 on its own)
and a cola (€3.00 on its own); shared by those prices, the burger carries €9.12 at 10% and the cola
€2.88 at 21%. Until you answer, the design keeps set menus off takeaway orders.

- May the price be shared by each part's own price? Must the share be exact?
- If the guest leaves out the cola and still pays €12.00, is it all food at 10%?
- At a counter in a venue with tables or a bar: does a cola rung up as drunk here (10%) stay at 10%
  if the customer walks out with it? If the customer says nothing, may it be rung up as drunk here?

Yes / No / Note: ____________________________________________

**2. Keeping a date that nothing shows to be wrong (T2).** After every start, the box records no
sale until its time is confirmed, by internet time, by two of the venue's devices agreeing, or by a
person. If that confirmation was itself wrong and the sale was paid in cash, nothing may show the
real time; a card payment carries the card provider's own time. Our answer: when nothing shows the
stamped date is wrong, the restaurant keeps it. Is that right, and is anything more needed to rely
on it?

Yes / No / Note: ____________________________________________

#### Confirmations: what is filed or signed from the first day

**3. When the meal ends, and whether the ticket may wait for payment (follows his answers 1.1,
1.3 and 1.4; rewritten 15 November).** He confirmed that a ticket issued at the end of the meal, in
the same visit, carries one date, and that one issued on a later day must also show the date of the
sale, at that day's VAT rates. He also said the ticket is due when the meal ends and cannot wait for
the bill to be paid in full. Two points remain:

- (a) Does the meal end when the last dish is served, or when the guests finish and leave? Example:
  the last dish at 23:40, then coffee; the table pays and leaves at 00:30. We would date the ticket
  00:30, the next day, as its only date.
- (b) A regular eats on Monday and, by arrangement, pays on Thursday. Must the ticket be issued on
  Monday, unpaid, or may it wait until Thursday and show Monday as the date of the sale? His answer
  1.4 mentions invoices issued after payment by transfer; his answer 1.3 says issue cannot wait for
  full payment.

Yes / No / Note: ____________________________________________

**4. A series for correctives of a wrong date (follows his answer 1.14; rewritten 15 November).**
He confirmed that ticket correctives (R5) need a series apart from full-invoice correctives (R1 to
R4). Waitron puts every ticket corrective, including one issued because the ticket's date was
wrong, in one series that holds only ticket correctives. Rulings V1665-22, V0902-22, V1924-23 and
V2611-24 say a corrective of a wrong issue date must be in a series of its own. Is one series of
ticket correctives enough, or must date correctives have a series apart from the other ticket
correctives?

Yes / No / Note: ____________________________________________

**5. The software declaration: what the system consists of (T14).** The producer must sign a
declaration for each version (the declaración responsable, Orden HAC/1177/2024 art. 15), and none is
signed yet. Its item d), as the release template holds it today, is in the
[annex](#anexo-el-apartado-d-tal-como-está-hoy). It now names the third-party
components as a present fact, says the producer answers for them, and says which version of the
Veri\*Factu library is used and what it does. We think it is enough with two additions: what the
print agent does, and that the terminals ask for invoices and show them. The sentence on a standby
server stays only in a version that can switch to one.

Yes / No / Note: ____________________________________________

**6. The software declaration: several taxpayers (T15).** Waitron answers N to item f): each venue
has its own installation, database and certificate, on its own box or in Waitron Cloud. The
Veri\*Factu library, declared separately under the code WV, answers S, because a program using it
can file for several taxpayers (owner, 14 November). A venue that moves between its own box and
Cloud keeps Waitron's system code, gets a new installation number and needs no new declaration.

Yes / No / Note: ____________________________________________

#### Confirmations: when the clock was wrong

The box dates each invoice from its own clock, kept right by internet time. After a start, or a
jump of more than a minute while internet time is unavailable, it takes no payment until its time is
confirmed, by internet time, two devices or a person. It no longer asks AEAT for the time.

**7. A wrong date on an invoice (T7, and the owner's answer of 14 November on the VAT period).** It
is put right with a corrective in the series of question 4, dated the day it is issued, stating the
real date of the sale and changing no amount (DGT V1665-22; V0305-24). VAT counts in the real
date's period (LIVA 75.Uno.2.º); if that period's return is already filed, a complementary return
fixes it (LGT art. 122). One corrective may cover several invoices (RD 1619/2012 art. 15.4). Built
today for a ticket AEAT refused as dated in the future; the full-invoice version is built but
switched off.

Yes / No / Note: ____________________________________________

**8. Who receives the corrective (T1).** Most ticket customers are unknown. The restaurant issues the
corrective, keeps it and sends its record to AEAT; it reaches a customer only when the restaurant
knows who they are. Tickets are not cancelled and reissued. We found no source on this.

Yes / No / Note: ____________________________________________

**9. A record timed earlier than the one before (T5).** If the clock ran fast and is set right, the
next record carries an earlier time than the last. Waitron allows this and marks nothing: a record
must carry the exact date and time it was made (Orden HAC/1177/2024 art. 7.e), and art. 3 switches
off, for Veri\*Factu systems, art. 7.i, which holds the one rule against it. Example: invoices 2, 3
and 4 are stamped by a clock an hour fast; once it is set right, invoice 5 carries an earlier time
than invoice 4. Invoices 2 to 4 are corrected only if the wrong hour moved one of them to another
day (question 7).

Yes / No / Note: ____________________________________________

**10. Only the hour is wrong (T6).** A ticket stamped 21:10 for a sale at 20:50 the same day needs no
corrective; the restaurant keeps a note of the incident. An invoice shows its date, not its time
(RD 1619/2012 arts. 6.1.b and 7.1.b), and the developer FAQ says the time of issue is not part of
the record. One passage points the other way: the developer FAQ, §17 case 2.b, says an error in an
internal field needs a correcting record.

Yes / No / Note: ____________________________________________

**11. Telling AEAT about a clock incident (T8).** We think there is no duty or channel to report one:
a text search of the Reglamento, the Orden, both FAQs and AEAT's technical documents found none, and
the corrective's record reaches AEAT anyway. Orden art. 16.4 covers incidents that stop records
being sent, which is a different case.

Yes / No / Note: ____________________________________________

#### Confirmations: keeping records and giving access

**12. "Online access" without the internet (T4).** A copy on the venue's own box meets RD 1619/2012
arts. 21.2 and 23 if, when the tax office asks, it can without unjustified delay see, search, copy or
download, and print every invoice. No permanent connection or public address is needed (Orden
EHA/962/2007 art. 5.3; DGT 0289-04). If AEAT asks from its own office, a copy of the period on a USB
drive or by a temporary download link is enough.

Yes / No / Note: ____________________________________________

**13. What a restaurant company keeps (T11).** Invoices issued, tickets included, and invoices
received (RD 1619/2012 art. 19.1); books, correspondence and business papers (Código de Comercio
art. 30.1); other evidence for its taxes (LGT art. 29.2.e); records of payments and refunds; the
software declaration of every version used; proof of payment of sales of €1,000 or more, kept five
years (Ley 7/2012 art. 7.Uno.4); and pro formas that never became invoices. All on one six-year
schedule. Is anything missing?

Yes / No / Note: ____________________________________________

**14. Records AEAT does not hold (T12).** A record still waiting to be sent, or one AEAT refused, is
kept with AEAT's reply until it is settled, then on the common schedule. In the developer FAQ's
words, such a record would never be in AEAT's systems, so the restaurant's copy is the only one. No
source sets a period.

Yes / No / Note: ____________________________________________

#### Follow-ups on his answers of 15 November

Each comes from a gap his answer leaves; the reasoning is in
[2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md).

**15. A payment on account during the meal (his 1.3).** He said a payment made before the table is
fully served is an advance payment needing its own ticket, where what it pays for is clearly
identified (CJEU C-419/02, BUPA). Example: a table of four has €120 on the bill and has not ordered
desserts. At 21:30 Ana pays €30 "towards the bill" and leaves; the others pay the rest at 23:00.

- (a) Are Ana's €30 an advance payment, when they are an amount rather than particular dishes and
  the table may still order more?
- (b) If so, may her ticket list the dishes ordered so far as paid on account, and the final
  ticket show the total less the advance's base and VAT, as with a deposit (his 1.8)?

Yes / No / Note: ____________________________________________

**16. Delivering the ticket in practice (his 1.11).** We will print every ticket at payment unless
the customer chooses email.

- (a) Is a ticket printed and left with the bill delivered, even if the customer leaves it on the
  table or says they don't want it?
- (b) For email, staff ask "paper or email?"; the till shows "We'll email your ticket to this
  address. You can ask for a paper copy at any time." and records that it was shown. Is that
  informed consent, and is sending the email enough to show delivery, or must the customer open or
  download it?

Yes / No / Note: ____________________________________________

**17. A whole table, or a staff meal, given free (his 1.10).** Example: the venue invites a table of
four regulars; menu value €160, food cost €48. If it is treated as a self-supply at cost:

- (a) What is the cost of a restaurant meal: the ingredients only, or a share of staff and
  overheads too? Without recipe costs, may the venue use a standard percentage of the menu price
  (say 30%)?
- (b) Which document is issued, to whom (the venue itself, or the table), and what record does it
  send to AEAT?
- (c) A meal given free to an employee during their shift: also a self-supply at cost, or outside
  VAT?

Yes / No / Note: ____________________________________________

**18. A deposit kept after a no-show (his 1.7 and 1.8).** A €40 deposit for a booking has its own
ticket (base €36.36, VAT €3.64 at 10%). The guests don't come and the venue keeps the €40 as
compensation, which he says is outside VAT (DGT V0839-20). Does the venue issue a corrective
removing the €3.64, though it refunds nothing (LIVA 89.Cinco.b asks for a refund to reduce VAT), or
does the deposit's ticket stand?

Yes / No / Note: ____________________________________________

**19. Money given back as goodwill after the ticket (his 1.5).** A guest complains after paying €62
and the manager gives €10 back. He said a later price reduction requires a corrective "where
applicable" (LIVA 80.Uno.2.º). Is the corrective required, or may the venue give the money back
without one and go on declaring VAT on €62?

Yes / No / Note: ____________________________________________

**20. Who is the third party for copies outside Spain (his 1.15).** Waitron Cloud plans to keep
copies with Amazon Web Services, a company with an American parent, in data centres in Spain and
France. A venue may instead send its continuous copy to a storage provider it chooses.

- (a) Is the third party of art. 19.3 the company the venue contracts with (Waitron), the storage
  provider, or both?
- (b) Does art. 19.4 look at where the third party is established or where the data is held? For
  example, a provider established outside the EU that stores the data in an EU data centre.

Yes / No / Note: ____________________________________________

**21. Copies rebuilt from AEAT's records after a restore (his 1.16).** He suggests rebuilding lost
invoice copies from AEAT's record query. As AEAT's technical documents describe it, its reply
carries each record's number, date, description, customer where there is one, VAT breakdown and
totals, but not the dishes. Is a copy rebuilt from that acceptable under RD 1619/2012 art. 19, or
must the venue hold the full invoice some other way, such as its continuous copy?

Yes / No / Note: ____________________________________________

**22. Still awaited from October.** S17 (selling by weight: legal metrology, or whom to ask), S18
(a change of legal name with the same tax ID) and S19 (keeping a chain's later records unsent while
an earlier one's answer is unknown). When can we expect them?

Note: ____________________________________________

### Appendix: labour and privacy (drop it if you wish)

These need a labour adviser and a privacy specialist, not yet found (owner's plan, 9 November, in
[action-plan.md](action-plan.md)). Only the three questions needing judgement are here. The
confirmations L3 to L8 and P2 to P10 stand as written in the 6 November list, except that P4 must
first be updated for A1404 (#2627, 9 November), which encrypts the bucket copy with a key derived
from the recovery key.

- **L1.** Card tips paid through payroll: do they attract social security contributions? We think
  yes, reported under code 0001. No ruling or TGSS statement covers a restaurant.
- **L2.** Under the agreement's 1,783 hours a year, is overtime what exceeds the person's published
  calendar for the day or the nine-hour limit? The Statute counts it against the maximum ordinary
  working day (ET arts. 34 and 35.1), not a calendar.
- **P1.** May a restaurant keep allergy notes after the meal as evidence, set aside (blocked), under
  GDPR art. 9(2)(f) before any claim exists? For one, three or five years?

## Part 2: Español (para el asesor fiscal)

Preguntas para la reunión del jueves 19 de noviembre de 2026. Cada una describe lo que hace Waitron
y por qué, y pide un sí o una corrección. Las dos primeras requieren su criterio; las demás son
confirmaciones, ordenadas según lo que se remite o se firma desde el primer día de actividad.
Gracias por sus respuestas del 15 de noviembre a las S1 a S16 y R1 a R6 (sus apartados 1.1 a 1.16 y
2.1 a 2.6). Las preguntas 3 y 4 y las 15 a 21 parten de ellas; la 22 recuerda las S17 a S19, aún
pendientes.

### Requieren su criterio

**1. Precio único de un menú para llevar.** Consumido en el local y servido por su personal, un menú
es un único servicio de restauración al 10 %, bebida incluida (LIVA art. 91.Uno.2.2.º). Para llevar o
a domicilio es una entrega de bienes y cada parte tributa a su tipo: la comida al 10 % y un refresco
azucarado al 21 % (LIVA art. 91.Uno.1.1.º; DGT V2949-16). Ejemplo: un menú para llevar de 12,00 €,
IVA incluido, con hamburguesa (9,50 € por separado) y refresco (3,00 € por separado); repartido según
esos precios, la hamburguesa lleva 9,12 € al 10 % y el refresco 2,88 € al 21 %.

- ¿Puede repartirse el precio según el precio de cada parte vendida por separado? ¿Debe ser exacto
  el reparto?
- Si el cliente prescinde del refresco y paga igualmente 12,00 €, ¿es todo comida al 10 %?
- En una barra de un local con mesas o barra disponibles: si se cobra un refresco para tomar aquí
  (10 %) y el cliente se lo lleva, ¿se mantiene el 10 %? Si el cliente no dice nada, ¿puede cobrarse
  como para tomar aquí?

Sí / No / Nota: ____________________________________________

**2. Mantener una fecha que nada indica que sea errónea.** Tras cada arranque, el servidor no registra
ventas hasta confirmar su hora: por la hora de internet, por dos dispositivos del local que
coinciden o por una persona. Si esa confirmación fuera errónea y la venta se cobrara en efectivo,
puede no haber prueba de la hora real; un pago con tarjeta lleva la hora del proveedor. Proponemos
que, si nada indica que la fecha registrada sea errónea, el restaurante la mantenga. ¿Es correcto?
¿Hace falta algo más para sostenerla?

Sí / No / Nota: ____________________________________________

### Confirmaciones: lo que se remite o se firma desde el primer día

**3. Cuándo termina la comida, y si el tique puede esperar al cobro (a partir de sus respuestas
1.1, 1.3 y 1.4).** Confirma que el tique expedido al terminar la comida, en la misma visita, lleva una
sola fecha, y que el expedido un día posterior debe indicar además la fecha de la operación, con los
tipos de IVA de ese día. Indica también que el tique se expide al terminar el servicio, sin quedar
condicionado al cobro total. Quedan dos puntos:

- (a) ¿Termina la comida al servirse el último plato, o cuando los clientes acaban y se marchan?
  Ejemplo: último plato a las 23:40 y después café; la mesa paga y se marcha a las 00:30. Fecharíamos
  el tique a las 00:30 del día siguiente, con esa única fecha.
- (b) Un cliente habitual come el lunes y, por acuerdo, paga el jueves. ¿Debe expedirse el tique el
  lunes, aún sin cobrar, o puede esperar al jueves indicando el lunes como fecha de la operación? Su
  respuesta 1.4 menciona facturas expedidas tras un pago por transferencia; la 1.3, que la expedición
  no puede quedar condicionada al cobro total.

Sí / No / Nota: ____________________________________________

**4. Serie de las rectificativas por fecha errónea (a partir de su respuesta 1.14).** Confirma que
las rectificativas de tiques (R5) van en una serie distinta de las de facturas completas (R1 a R4).
Waitron pone todas las R5, también las que se expiden porque la fecha del tique era errónea, en una
serie que solo contiene R5. Las V1665-22, V0902-22, V1924-23 y V2611-24 dicen que la rectificativa de
una fecha de expedición errónea «deberá constar en serie específica de factura». ¿Basta una serie
solo de R5, o deben ir las rectificativas por fecha en una serie aparte de las demás R5?

Sí / No / Nota: ____________________________________________

**5. Declaración responsable: componentes del sistema.** Apartado d) del art. 15 de la Orden
HAC/1177/2024; aún no se ha firmado ninguna. El texto actual está en el
[anexo](#anexo-el-apartado-d-tal-como-está-hoy). Creemos que basta con dos añadidos: qué hace el
agente de impresión, y que los terminales solicitan las facturas y las muestran. La frase sobre el
servidor de reserva solo figurará en una versión que pueda pasar a él.

Sí / No / Nota: ____________________________________________

**6. Declaración responsable: varios obligados tributarios.** Waitron responde N al apartado f): cada
local tiene su propia instalación, base de datos y certificado, en su propio equipo o en Waitron
Cloud. La biblioteca Veri\*Factu, con declaración propia y código WV, responde S, porque un programa
que la use puede facturar para varios obligados. Un local que pasa de su propio equipo a Waitron
Cloud, o al revés, conserva el código de sistema de Waitron, recibe un nuevo número de instalación y
no necesita nueva declaración.

Sí / No / Nota: ____________________________________________

### Confirmaciones: cuando el reloj estaba mal

El servidor fecha cada factura con su propio reloj, que mantiene en hora mediante internet. Tras un
arranque, o un salto de más de un minuto sin hora de internet, no admite cobros hasta confirmar su
hora: por internet, por dos dispositivos o por una persona. Ya no consulta la hora de la AEAT.

**7. Fecha errónea en una factura.** Se corrige con una rectificativa en la serie de la pregunta 4,
fechada el día en que se expide, que indica la fecha real de la operación y no cambia ningún importe
(DGT V1665-22: «será necesaria la expedición de una factura rectificativa»; V0305-24). El IVA se
imputa al periodo de la fecha real (LIVA art. 75.Uno.2.º); si esa declaración ya se presentó, se
corrige con una complementaria (LGT art. 122). Una rectificativa puede corregir varias facturas
(RD 1619/2012, art. 15.4). Ya funciona para un tique que la AEAT rechazó por fecha futura; la versión
para facturas completas está hecha pero desactivada.

Sí / No / Nota: ____________________________________________

**8. A quién llega la rectificativa.** La mayoría de los clientes de tique son desconocidos. El
restaurante expide la rectificativa, la conserva y remite su registro; solo llega al cliente cuando el
restaurante sabe quién es. No se anulan ni se vuelven a expedir tiques. No hemos encontrado norma
sobre este caso.

Sí / No / Nota: ____________________________________________

**9. Un registro con hora anterior a la del anterior.** Si el reloj iba adelantado y se corrige, el
siguiente registro lleva una hora anterior a la del último. Waitron lo permite sin marcarlo: el
registro debe incorporar «la fecha y hora exactas» de su generación (Orden HAC/1177/2024, art. 7.e), y
el art. 3 excluye para VERI\*FACTU el art. 7.i), que contiene la única regla en contra. Ejemplo: las
facturas 2, 3 y 4 se fechan con el reloj una hora adelantado; corregido el reloj, la factura 5 lleva
una hora anterior a la de la 4. Las facturas 2 a 4 solo se rectifican si la hora errónea pasó alguna
a otro día (pregunta 7).

Sí / No / Nota: ____________________________________________

**10. Solo la hora es errónea.** Un tique fechado a las 21:10 por una venta de las 20:50 del mismo
día no necesita rectificativa; el restaurante guarda constancia del incidente. La factura indica la
fecha, no la hora (RD 1619/2012, arts. 6.1.b y 7.1.b), y las FAQ para desarrolladores dicen: «La hora
de expedición e impresión material de la factura no forma parte del RF». En sentido contrario, el
caso 2.b de su apartado 17 pide un registro de subsanación para un error en un campo interno.

Sí / No / Nota: ____________________________________________

**11. Comunicar a la AEAT un incidente de reloj.** Creemos que no hay obligación ni cauce: una
búsqueda en el Reglamento, la Orden, las dos FAQ y los documentos técnicos no encontró ninguno, y el
registro de la rectificativa llega a la AEAT igualmente. El art. 16.4 de la Orden trata las
incidencias que impiden la remisión, que es otro caso.

Sí / No / Nota: ____________________________________________

### Confirmaciones: conservación y acceso

**12. Acceso en línea sin internet.** Una copia en el propio equipo del local cumple los arts. 21.2 y
23 del RD 1619/2012 si, cuando la Administración lo pide, permite sin demora injustificada consultar,
buscar, copiar o descargar e imprimir todas las facturas. No hace falta conexión permanente ni
dirección pública (Orden EHA/962/2007, art. 5.3; DGT 0289-04). Si la AEAT lo pide desde su oficina,
basta una copia del periodo en USB o un enlace temporal de descarga.

Sí / No / Nota: ____________________________________________

**13. Qué conserva una sociedad de restauración.** Facturas expedidas, tiques incluidos, y recibidas
(RD 1619/2012, art. 19.1); libros, correspondencia y documentación (Código de Comercio, art. 30.1);
demás justificantes tributarios (LGT art. 29.2.e); registros de cobros y devoluciones; la declaración
responsable de cada versión utilizada; justificantes de pago de ventas de 1.000 € o más, cinco años
(Ley 7/2012, art. 7.Uno.4); y proformas que no llegaron a factura. Todo con un calendario común de
seis años. ¿Falta algo?

Sí / No / Nota: ____________________________________________

**14. Registros que la AEAT no tiene.** Un registro pendiente de envío, o rechazado, se conserva con
la respuesta de la AEAT hasta resolverse y después según el calendario común, porque ese registro «no
figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)» (FAQ para desarrolladores).
No hemos encontrado plazo.

Sí / No / Nota: ____________________________________________

### A partir de sus respuestas del 15 de noviembre

**15. Un pago a cuenta durante la comida (su respuesta 1.3).** Indica que un pago anterior a que la
mesa esté servida del todo es un pago anticipado con su propia factura, cuando lo que se paga está
claramente identificado (STJUE C-419/02, BUPA). Ejemplo: una mesa de cuatro lleva 120 € consumidos y
aún no ha pedido postres. A las 21:30 Ana paga 30 € «a cuenta» y se marcha; los demás pagan el resto
a las 23:00.

- (a) ¿Son esos 30 € un pago anticipado, si son un importe y no platos concretos y la mesa aún puede
  pedir más?
- (b) Si lo son, ¿puede su tique recoger como pagados a cuenta los platos pedidos hasta ese momento,
  y el tique final mostrar el total menos la base y la cuota del anticipo, como con una señal (su
  respuesta 1.8)?

Sí / No / Nota: ____________________________________________

**16. La entrega del tique en la práctica (su respuesta 1.11).** Imprimiremos todos los tiques al
cobrar, salvo que el cliente elija el correo electrónico.

- (a) ¿Se considera entregado el tique impreso y dejado con la cuenta, aunque el cliente lo deje en
  la mesa o diga que no lo quiere?
- (b) Para el correo, el empleado pregunta «¿en papel o por correo?»; la caja muestra «Le enviaremos
  el tique a esta dirección. Puede pedir una copia en papel en cualquier momento» y registra que se
  mostró. ¿Es consentimiento informado, y basta el envío del correo como prueba de entrega, o hace
  falta que el cliente lo abra o lo descargue?

Sí / No / Nota: ____________________________________________

**17. Una mesa invitada, o una comida de personal (su respuesta 1.10).** Ejemplo: el local invita a
una mesa de cuatro clientes habituales; valor en carta 160 €, coste de materia prima 48 €. Si se
trata como autoconsumo a coste:

- (a) ¿Qué es el coste de una comida de restaurante: solo la materia prima, o también una parte del
  personal y de los gastos generales? Sin escandallos, ¿puede usarse un porcentaje estándar sobre el
  precio de carta (por ejemplo, el 30 %)?
- (b) ¿Qué documento se expide, a quién (al propio local o a la mesa) y qué registro se remite a la
  AEAT?
- (c) La comida que se da gratis a un empleado durante su turno: ¿también autoconsumo a coste, o no
  sujeta?

Sí / No / Nota: ____________________________________________

**18. Señal retenida cuando el cliente no se presenta (sus respuestas 1.7 y 1.8).** Una señal de
40 € por una reserva tiene su propio tique (base 36,36 €, cuota 3,64 € al 10 %). Los clientes no se
presentan y el local retiene los 40 € como indemnización, que según la V0839-20 no está sujeta.
¿Expide el local una rectificativa que anule los 3,64 €, aunque no devuelve nada (el art.
89.Cinco.b LIVA exige reintegrar la cuota para minorarla), o se mantiene el tique de la señal?

Sí / No / Nota: ____________________________________________

**19. Devolución de cortesía tras el tique (su respuesta 1.5).** Un cliente se queja después de
pagar 62 € y el encargado le devuelve 10 €. Indica que una rebaja posterior requiere, en su caso, una
rectificativa (art. 80.Uno.2.º LIVA). ¿Es obligatoria, o puede el local devolver el dinero sin
rectificativa y seguir declarando el IVA sobre los 62 €?

Sí / No / Nota: ____________________________________________

**20. Quién es el tercero para las copias fuera de España (su respuesta 1.15).** Waitron Cloud prevé
guardar las copias en Amazon Web Services, empresa de matriz estadounidense, en centros de datos de
España y Francia. Un local puede, en cambio, enviar su copia continua a un proveedor de
almacenamiento de su elección.

- (a) ¿Es el tercero del art. 19.3 la empresa con la que contrata el local (Waitron), el proveedor de
  almacenamiento, o ambos?
- (b) ¿El art. 19.4 atiende al lugar de establecimiento del tercero o al lugar donde están los
  datos? Por ejemplo, un proveedor establecido fuera de la UE que guarda los datos en un centro de
  datos de la UE.

Sí / No / Nota: ____________________________________________

**21. Copias reconstruidas con los registros de la AEAT tras una restauración (su respuesta 1.16).**
Propone reconstruir las copias perdidas a partir de la consulta de registros de la AEAT. Según los
documentos técnicos de la AEAT, su respuesta incluye de cada registro el número, la fecha, la
descripción, el destinatario si lo hay, el desglose de IVA y los importes totales, pero no los
platos. ¿Es aceptable una copia reconstruida así a efectos del art. 19 del RD 1619/2012, o debe el
local conservar la factura completa por otra vía, como su copia continua?

Sí / No / Nota: ____________________________________________

**22. Pendientes desde octubre.** La S17 (venta a peso: metrología legal, o a quién consultar), la
S18 (cambio de denominación social con el mismo NIF) y la S19 (retener los registros posteriores de
una cadena mientras se desconoce la respuesta a uno anterior). ¿Cuándo podemos esperar su respuesta?

Nota: ____________________________________________

### Anexo: el apartado d), tal como está hoy

Texto de la plantilla de la declaración (`packages/fiscal-verifactu/declarations/template.md`, líneas 13 a 36). Los valores entre ‹ › los rellena cada versión.

> **1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
> esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
> informático y de sus principales funcionalidades:**
>
> Waitron es un software de punto de venta para restaurantes y bares. Se ejecuta en un servidor
> —un equipo del propio establecimiento o un servidor en la nube— con Linux y Docker, y los
> terminales del establecimiento (cajas, comanderos, pantallas de cocina y el panel de gestión) se
> conectan a él por la red mediante un navegador. Opcionalmente, un segundo servidor de reserva en
> el establecimiento mantiene una copia continua de los datos y puede sustituir al principal si este
> falla.
>
> Hardware: Waitron no incluye hardware propio; funciona en cualquier ordenador que cumpla lo
> anterior.
>
> Software: el servidor Waitron, que genera, encadena, conserva y remite los registros de
> facturación; la biblioteca @waitron/verifactu (versión ‹versión de @waitron/verifactu›), que
> construye cada registro, su huella y el contenido del código QR, y lo remite, y que cuenta con su propia declaración
> responsable; las aplicaciones de los terminales, que no generan registros de facturación; el
> agente de impresión; y los componentes de terceros de los que nos hacemos responsables: Node.js,
> SQLite, Litestream, Linux y Docker (la lista completa se muestra en el propio sistema).
>
> Cada instalación lleva la facturación de un único obligado tributario y aplica una única modalidad
> de cumplimiento, determinada por el paquete de país instalado; esta versión solo funciona como
> VERI*FACTU.

### Apéndice: laboral y privacidad (para otro asesor)

- **L1.** ¿Cotizan las propinas de tarjeta que se abonan en nómina? Proponemos que sí, con el código
  0001. No hemos encontrado criterio de la TGSS para un restaurante.
- **L2.** Con la jornada anual de 1.783 horas del convenio, ¿son horas extraordinarias las que superan
  el calendario publicado de la persona para ese día o el límite de nueve horas? El ET las cuenta
  sobre la jornada máxima ordinaria (arts. 34 y 35.1), no sobre un calendario.
- **P1.** ¿Puede el restaurante conservar, bloqueadas, las anotaciones de alergias después de la
  comida como prueba, con base en el art. 9.2.f RGPD antes de que exista reclamación? ¿Durante uno,
  tres o cinco años?

## Dropped since 6 November

| Item | Why it is not asked | Receipt |
| --- | --- | --- |
| T13, the long-term archive | Owner, 15 November: "Agree, no archive now" (A1531) | `~/waitron-campaign-l/questions.md:1783-1785`; [backlog.md:2235](../backlog.md) |
| T16, a change of producer | Owner, 11 November, "Later": A993 is built only once a change is scheduled. Its venue-move half is now in question 6 | commit `e59fac8c94`; [backlog.md:246-249](../backlog.md) |
| T9 and T10, tips | Held by the owner on 6 November until A793 is revived, and A793 is still not approved | [2026-11-06-adviser-questions.md:71-72](2026-11-06-adviser-questions.md); [backlog.md:1283-1286](../backlog.md) |
| S14's second half: may R5 and R1 to R4 share one series? | Owner, 15 November: they will not share; the adviser agreed the same day (his 1.14). Question 4 asks the narrower point | `~/waitron-campaign-shared/desk/done/20261115-1018-L-r5-series-date-rulings.md` |
| S4's last part: may the issue date stand as the date VAT falls due? | Owner, 12 and 15 November: one date when invoiced at the meal's end, the sale day when invoiced later. The adviser agreed on 15 November (his 1.4); question 3 now asks only when the meal ends and whether the ticket may wait | [backlog/fiscal.md:1103-1116](../backlog/fiscal.md); `desk/done/20261115-0530-L-later-sale-date-rule.md`, `20261115-1113-L-later-sale-q1-open-bill.md`, `20261115-1113-L-later-sale-q2-vat-period.md` |
| The 6 November background on AEAT's time (decision 2b and "How a wrong clock is known") | Owner, 10 to 13 November: Waitron reads AEAT's time only to warn of drift, and a refusal for a future date no longer stops a box whose internet time is synchronised | [CLAUDE.md:958-967 and 995](../../CLAUDE.md) |
