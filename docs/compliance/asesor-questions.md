# Questions for the asesor

Companion to [verifactu-findings.md](verifactu-findings.md), which records what is already
settled. **Do not ask about anything in that document** — it is sourced from AEAT and BOE
primary texts. These are the items that research could not resolve.

Each question has English context (for us) and a Spanish formulation (to hand over).

---

## Who to ask

**Primary — an asesor fiscal who has implemented a SIF.** Not a generalist gestor. These are
technical questions about the architecture of the invoicing system, and a tax filer will
answer the easy half ("yes, multiple series are fine") while missing the part that matters.
Ask up front whether they have advised on or certified a SIF.

**For Q1 and Q2 specifically — consider a consulta vinculante to the DGT.** This is the only
route to a binding answer. Free, but 3–6 months. Both questions are load-bearing enough that
filing early and building on the provisional answer is defensible.

**Also worth trying — AEAT's Verifactu technical channel for developers.** Faster than DGT
and more likely to engage with the encadenamiento scoping directly. Non-binding.

**Q9 is not for the asesor fiscal.** It concerns liability for distributing open-source
software rather than the operation of our own SIF, and carries the largest financial exposure
here. Take it to a lawyer, and file it as a DGT consulta vinculante alongside Q1 and Q2.

---

## BLOCKING — the architecture depends on these

### Q1. Is a till that syncs to a shared backend within minutes an independent SIF?

**Why it matters.** Per-till chains are lawful only if each till is its own SIF. AEAT's
ERP-modules FAQ contrasts real-time centrally-controlled modules (one SIF, one chain) against
decentralised modules uploading *monthly* (separate SIFs). We sit between them, and AEAT's
wording is hedged (*"puede entenderse"*). If this resolves against us, per-till chains
collapse into one chain per issuer, which would require asking a server for the next chain
position before completing any sale — breaking offline operation entirely.

> Un TPV genera localmente y de forma autónoma sus propios registros de facturación de alta,
> su huella y su código QR, sin conexión en tiempo real con ningún sistema central y sin ser
> controlado por él. Puede operar así indefinidamente. Cuando hay red, sincroniza con un
> servidor común (local o en la nube) en cuestión de minutos.
>
> **¿Se considera cada TPV un sistema informático de facturación independiente a efectos del
> artículo 7.c) de la Orden HAC/1177/2024, con su propia cadena de registros de facturación?**
>
> La FAQ de la AEAT sobre módulos de un ERP contrapone módulos interconectados y controlados
> en tiempo real (un solo SIF, un solo encadenamiento) frente a módulos inconexos que remiten
> los registros al ERP una vez al mes (SIF diferentes). Nuestro caso es intermedio: la lógica
> obligatoria es descentralizada, pero la sincronización es frecuente.
>
> ¿Qué factor es determinante — dónde se genera el registro, o con qué frecuencia se
> sincroniza? ¿Existe algún umbral de frecuencia a partir del cual la AEAT consideraría que
> los TPV forman un único SIF?

### Q2. May a node other than the till transmit the till's records to AEAT?

**Why it matters.** Our design deliberately keeps the fiscal certificate off tills sitting on
counters — records chain at the till, flow upstream, and the nearest node holding the
certificate submits. This resembles the pattern AEAT rejected as *"remisión en diferido"*,
though that FAQ's stated rationale (the customer already left with a printed invoice)
arguably confirms the till is the SIF rather than prohibiting relayed transmission. If the
answer is that the SIF itself must transmit, certificates land on every till and the security
model changes substantially.

> Nuestro diseño mantiene el certificado fiscal fuera de los TPV por seguridad — un TPV es una
> tablet en un mostrador. Los registros se encadenan en el TPV, se transmiten al nodo superior
> (servidor local o nube) y **ese nodo, que custodia el certificado, los remite a la AEAT** en
> nombre del obligado tributario, normalmente en segundos.
>
> **¿Es válida esta remisión delegada, siendo el TPV el SIF que genera el registro pero no
> quien abre la conexión con la AEAT?**
>
> El artículo 8.1 del RD 1007/2023 exige que el SIF "tenga capacidad de remitir" — ¿se cumple
> esa capacidad si la remisión se ejerce a través de un nodo superior del mismo sistema?
>
> Nos preocupa la FAQ de la AEAT que rechaza el "volcado" al final del día de los registros de
> un sistema desconectado a un sistema conectado para su remisión. Entendemos que esa
> prohibición se refiere a tratar el sistema central como el punto de expedición (el
> razonamiento de la AEAT es que "los clientes ya se habrán llevado las facturas impresas"),
> y no a la mera transmisión técnica por cuenta del SIF que sí expidió. **¿Es correcta esa
> lectura?**

---

## IMPORTANT — affects scope and product shape

### Q3. Is an intentionally-offline till in Verifactu mode compliant?

**Why it matters.** Some users have no usable connectivity and would sync once daily. Art.
16.4 tolerates outages indefinitely provided hourly retries continue, and there is no
deadline — but deliberate offline operation is not an outage. Determines whether these users
can stay in Verifactu mode or must run the substantially more expensive non-Verifactu build.

> Un TPV en modalidad VERI\*FACTU permanece deliberadamente sin conexión durante toda la
> jornada (el usuario no dispone de conectividad fiable), reintentando la remisión cada hora
> sin éxito, marcando `Incidencia="S"` y mostrando el aviso de registros pendientes. Al cierre
> recupera conexión y remite todo en orden cronológico.
>
> **¿Es esto una incidencia técnica amparada por el artículo 16.4 de la Orden HAC/1177/2024, o
> se consideraría de facto la "remisión en diferido" prohibida?**
>
> ¿Cambia la respuesta si la falta de conexión es permanente y conocida de antemano, en lugar
> de sobrevenida? ¿Existe algún criterio sobre incidencias prolongadas o recurrentes?

### Q4. Can one taxpayer run some tills in Verifactu and others in no verificable?

**Why it matters.** Mode is per SIF, so per till — but the Verifactu election has a
calendar-year lock-in whose scope (per taxpayer or per SIF) we could not determine. A venue
with one reliable till and one in a dead spot is a realistic configuration.

> La modalidad se elige por SIF, de modo que un obligado tributario puede tener un SIF en
> VERI\*FACTU y otro en modalidad no verificable. Un mismo local podría tener un TPV con buena
> conectividad y otro sin ella.
>
> **¿Es admisible esta configuración mixta dentro de un mismo local y un mismo NIF?**
>
> La AEAT la desaconseja por generar "listados incompletos de facturas emitidas" — ¿supone eso
> algún riesgo real de requerimiento o sanción, o es sólo una molestia administrativa?
>
> Además: la permanencia obligatoria en VERI\*FACTU hasta el fin del año natural, **¿se aplica
> por obligado tributario o por SIF?** Es decir, ¿puede darse de alta un TPV nuevo en
> modalidad no verificable a mitad de año si otros TPV del mismo NIF ya operan en VERI\*FACTU?

### Q5. Series requirements — the part we could not source

**Why it matters.** We assume one series per till. Research confirmed the chaining rules but
never verified the underlying series permission in RD 1619/2012 art. 6.1.a. Low risk, but it
is the foundation of the numbering scheme. The rectificativa question is the practical one:
it is the case where a single till needs two series (and, per art. 7.c, still one chain).

> **(a)** ¿Permite el artículo 6.1.a del RD 1619/2012 que un mismo obligado tributario utilice
> una serie de facturación distinta por cada TPV? ¿Qué exige exactamente "cuando existan
> razones que lo justifiquen" — basta una justificación operativa, debe documentarse, y puede
> la AEAT cuestionarla a posteriori?
>
> **(b)** ¿Deben las facturas rectificativas emitirse obligatoriamente en una serie
> específica, distinta de la de las facturas ordinarias?
>
> **(c)** ¿Y las facturas simplificadas (tickets) frente a las facturas completas — requieren
> series separadas o pueden compartir serie?

---

## USEFUL — reduces uncertainty, not blocking

### Q6. Consequences of breaching the hourly-retry duty

No source addressed enforcement. LGT art. 201 bis has no delay-specific tipo, so it is
unclear whether a breach falls under *tenencia* of non-conforming software, general
obstruction, or is effectively unenforceable.

> El artículo 16.4 de la Orden HAC/1177/2024 obliga a reintentar el envío "al menos una vez
> cada hora" durante una incidencia. El artículo 201 bis de la LGT no contempla un tipo
> específico por retraso en la remisión.
>
> **¿Qué consecuencia tiene incumplir el deber de reintento horario?** ¿Se consideraría que el
> sistema deja de ajustarse al artículo 29.2.j) LGT, con la sanción por tenencia de 50.000 €
> por ejercicio, o queda fuera del régimen sancionador?
>
> Y sobre la justificación exigida en el art. 16.4 ("deberán ser debidamente justificadas por
> el remitente si así se lo requiere la AEAT"): **¿qué nivel de justificación se acepta, y a
> partir de cuánto tiempo de incidencia cabe esperar un requerimiento?**

### Q7. Installation-number lifecycle

The número de instalación must never repeat, including on reinstalling the same software on
the same reformatted machine. We need to know how far that extends before designing
provisioning.

> El nº de instalación no puede repetirse nunca para un mismo obligado. **¿Qué eventos exigen
> un nuevo número?** En concreto: reinstalación del software, reimagen del dispositivo,
> sustitución del hardware conservando los datos, traslado de un TPV a otro local del mismo
> NIF, y actualización de versión del software.
>
> Cuando un TPV se retira o se sustituye, **¿qué ocurre con su cadena de registros? ¿Basta con
> que termine, o hay que comunicar algo a la AEAT?**

### Q8. Clock accuracy on long-offline devices

> El artículo 7.f de la Orden exige exactitud de fecha y hora "con un margen máximo de error
> admitido de un minuto". Un TPV puede permanecer días sin conexión y por tanto sin
> sincronización horaria.
>
> **¿Qué se espera de un dispositivo que no puede sincronizar su reloj durante ese tiempo?**
> ¿Es aceptable la deriva del reloj interno, o hay que impedir la facturación si no puede
> garantizarse el margen de un minuto?

---

## SEPARATE — for a lawyer, not the asesor fiscal

### Q9. Who signs the declaración responsable for open-source software?

**Why it matters.** Blocks public release, not the build — but it has the largest financial
exposure of anything here, and the answer shapes the distribution model. What is already
settled is in [verifactu-findings.md](verifactu-findings.md) and §3 of the architecture design:
AEAT guidance explicitly covers open source (*"ya sea o no de código abierto"*), liability
attaches to whoever programs or integrates the code, and there is no homologación or registry.
Our working position is `josemmo`'s — a library is a tool for building SIFs, not a SIF — with
each deploying business signing for its own installation.

Two things that position does not settle:

**(a) Does publishing the source itself constitute *fabricación o comercialización*?**
LGT art. 201 bis sanctions the production and marketing of non-compliant software at
150.000 €/ejercicio plus 1.000 € per uncertified system sold. If publishing an open-source
codebase intended for building SIFs falls within *fabricación*, exposure attaches to the
project regardless of who deploys it. The `josemmo` disclaimer is a bet that it does not.

> Publicamos como código abierto un sistema de punto de venta que, una vez desplegado por un
> tercero, constituye un SIF. Nosotros no lo desplegamos para ese tercero, no lo
> comercializamos y no cobramos por él; cada empresa lo instala y lo configura por su cuenta.
>
> **¿Constituye la mera publicación del código fuente "fabricación o comercialización" de
> sistemas informáticos de facturación a efectos del artículo 201 bis de la LGT?**
>
> ¿Cambia la respuesta si además publicamos artefactos ejecutables (imágenes de contenedor)
> listos para desplegar, en lugar de sólo el código fuente?

**(b) Can a declaration be scoped to an immutable artifact?**
The most defensible form of a project-wide declaration: it covers a specific container digest,
so anyone running that exact digest runs exactly what was declared, and a rebuild is
unambiguously outside it. Untested — no AEAT doctrine addresses it.

> Estamos considerando emitir una declaración responsable referida a un artefacto concreto e
> inmutable (una imagen de contenedor identificada por su digest criptográfico), de modo que
> quien ejecute exactamente ese artefacto esté cubierto, y cualquier recompilación o
> modificación quede fuera.
>
> **¿Es admisible una declaración responsable así delimitada, y cubriría a los terceros que
> despliegan ese artefacto sin modificarlo?**
>
> ¿O debe cada obligado tributario emitir necesariamente la suya propia, con independencia de
> que el software sea idéntico al declarado por el fabricante?

**Route.** A DGT consulta vinculante is the only binding answer, and both parts are worth
filing together. Given the exposure, a lawyer rather than a gestor.

---

## Notes for the conversation

- **Lead with Q1 and Q2.** If the asesor cannot engage with those two, they are the wrong
  person and the rest of the meeting is not worth having.
- **Do not open with "can I use multiple series".** It is settled, it is boring, and it
  invites a confident answer to a question we did not need to ask. The series is not the
  mechanism — the SIF is.
- **Push for the reasoning, not just the verdict.** Where the answer rests on FAQ
  interpretation rather than regulation, we need to know that, because it changes how much
  weight the design can put on it.
- **Ask what they would put in writing.** A view they will not commit to in an email is a
  view we should not build an architecture on.
