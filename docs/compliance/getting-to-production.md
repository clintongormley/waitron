# Getting to production — sandbox access, certificates, go-live

Researched **2026-07-20**, substantially revised **2026-07-26** against AEAT, FNMT and BOE
primary sources. Companion to [verifactu-findings.md](verifactu-findings.md) and
[who-to-ask.md](who-to-ask.md). For the action list rather than the reasoning, see
[action-plan.md](action-plan.md).

> **Revision note (2026-07-26).** Three of the five "unverified" items are now closed: the seal
> certificate is priced, its delivery format is established, and its availability to private
> companies is confirmed. One item was outright wrong: the obligation dates moved to 2027. New
> material added on who may hold the submitting certificate (error 4112), the certificate type
> map, and delegation to third parties.

**The headline: there is nothing to apply for.** AEAT's preproduction environment is open to
anyone holding a real qualified certificate — no enrolment, no approval, no test NIFs. The
certificate is the entire gate, and it is the critical path.

**Second headline: there is no homologación.** No registry, no third-party certification, no
prior notification to AEAT. Compliance is self-certified by the producer via a declaración
responsable that is never filed anywhere.

> Vendor pages advertising "software homologado VeriFactu" are selling a fiction. AEAT: *"No.
> Para certificar un producto no se requiere de procesos de certificación realizados por otras
> personas, entidades u organismos independientes… En cuanto a su previo registro no está
> previsto en la norma."* The claim traces to Orden EHA/962/2007 *digitalización certificada*,
> an unrelated legacy regime. (TicketBAI **does** have a software registry — but that is the
> Basque regime, not ours.)

---

## 0. Deadlines

**Corrected 2026-07-26.** [Real Decreto-ley 15/2025](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840)
of 2 December 2025 amended RD 1007/2023's disposición final cuarta, postponing the taxpayer
dates by a year. The producer date was **not** postponed.

| Who | Original | Current |
| --- | --- | --- |
| Impuesto sobre Sociedades taxpayers (an SL) | 1 Jan 2026 | **1 Jan 2027** |
| Everyone else (IRPF, autónomos) | 1 Jul 2026 | **1 Jul 2027** |
| **Productores y comercializadores** | 29 Jul 2025 | **unchanged — already in force** |

The asymmetry is the point. As a *producer*, the obligations — a compliant product, a
declaración responsable per version — bit in July 2025. As an *obligado*, there is a year of
slack. Anyone marketing a SIF is already inside the regime regardless of their clients' dates.

---

## Critical path

| Order | Task | Blocks | Lead time |
| --- | --- | --- | --- |
| **1** | Obtain qualified certificate | **Everything** — no preproduction access without it | Days–weeks; not completable in one session |
| 2 | Declaración responsable | Public release | Draftable in parallel, never filed |
| 3 | Colaboración social / apoderamientos *(only if we submit for clients)* | Third-party submission | Unknown; start early. See §3 |
| — | Fiscal layer against conformance vectors | Nothing | **Start now, needs no certificate** |

The conformance vectors (`borjamrd/verifactu-conformance`, MIT) let us build and validate hash
construction, chaining, QR generation and XML shape entirely offline. **The certificate only
gates the final leg — actually talking to AEAT.** So: start the certificate paperwork
immediately because it is slow, then ignore it and build against the vectors while it grinds.

Note that step 3 is avoidable by design, and avoiding it is the recommended architecture — see
§3.

---

## 1. Certificates

### Which type

For an **unattended server** submitting automatically, the natural fit is a qualified
**certificado de sello electrónico / sello de entidad** — types 4 and 8 in @firma. It is not the
only option that works; see *"A seal is not legally required"* below.

FNMT verbatim:

> se admiten los certificados cualificados de sello electrónico y sello de entidad —tipos 4 y 8
> en @firma— para realizar la presentación mediante Web Service, pero estos dos tipos de
> certificado **no sirven** para realizar los envíos/consultas por sede electrónica.

AEAT confirms types 4 and 8 for *"procesos automatizados y masivos"* / *"comunicaciones máquina
a máquina"*, served from a separate subsede at `www10.agenciatributaria.gob.es`.

**You will need two certificates.** A seal is Web Service only — any manual sede-based
submission, query or correction, and AEAT's own free invoicing app, needs a persona física,
representante, or entidad-sin-personalidad certificate as well.

> ⚠️ **Operational trap.** A seal certificate sent to the standard `www1`/`prewww1` endpoint is
> rejected. Real-world integration failures trace to this misconfiguration rather than to the
> certificate itself. Seal certs go to `www10`/`prewww10`. See the endpoint matrix below.

**A seal is not legally required.** FNMT admits persona física and representante certificates
for the Web Service too — the seal's advantages are operational, not regulatory: it belongs to
the entity rather than to a named human, it survives a change of administrador, and machine
custody of the key is its stated purpose rather than a tolerated stretch of a personal
certificate's terms. That last point becomes decisive the moment a third party hosts the
system.

### Who the certificate holder must be

**This is the rule that actually governs which certificate you can use**, and it is enforced in
preproduction as well as production. From AEAT's error table:

> `4112 = El titular del certificado debe ser Obligado Emisión, Colaborador Social, Apoderado o Sucesor.`

Supporting validations in the same table:

| Code | Meaning |
| --- | --- |
| `4104` | NIF of the `ObligadoEmision` block not identified |
| `4107` | NIF not identified in AEAT's census |
| `1108` | `IDEmisorFactura` NIF must equal the `ObligadoEmision` NIF |
| `1109` | NIF not identified in AEAT's census (per-invoice) |
| `4110` | Technical error checking apoderamientos |
| `4132` | For queries: holder must be the destinatario, an Apoderado or a Sucesor |

So the certificate does not merely authenticate the transport — it must tie to the NIF placed in
`ObligadoEmision`. A personal certificate can only file for that person's own NIF. Testing "as
yourself" is possible but exercises a taxpayer profile the real obligado will never have; test
with the obligado's own certificate wherever possible.

### Certificate type map

Useful when inspecting a `.p12` to work out what you are actually holding:

```bash
openssl pkcs12 -in cert.p12 -clcerts -nokeys -legacy | \
  openssl x509 -noout -subject -issuer -dates -ext certificatePolicies
```

| Policy OID | Certificate |
| --- | --- |
| `1.3.6.1.4.1.5734.3.10.1` | Persona física (AC FNMT Usuarios) |
| `1.3.6.1.4.1.5734.3.11.1` | Representante para administradores únicos y solidarios |
| `1.3.6.1.4.1.5734.3.11.2` | Representante de persona jurídica (general) |
| `1.3.6.1.4.1.5734.3.11.3` | Representante de entidad sin personalidad jurídica |

The ETSI policy alongside it tells you the key custody regime:

| ETSI OID | Meaning |
| --- | --- |
| `0.4.0.194112.1.0` | QCP-n — qualified, natural person, **not** on a QSCD → software cert, exportable |
| `0.4.0.194112.1.1` | QCP-l — qualified, legal person (what a seal carries) |
| `0.4.0.194112.1.2` / `.3` | The QSCD variants — hardware-bound, **unusable for an unattended server** |

Representante certificates may also carry an FNMT-specific `description=Ref:…` field recording
the registry office and timestamp of accreditation — a quick way to see how a given certificate
was obtained. Observed on one sample; not confirmed as universal.

### FNMT costs (verified from FNMT's live price lists)

| Certificate | Cost | Validity |
| --- | --- | --- |
| Representante de persona jurídica | 14 € + IVA (**16,94 €**) | 2 years |
| Administrador único o solidario | 24 € + IVA (**29,04 €**) | 2 years |
| Entidad sin personalidad jurídica | **0 €** | — |
| **Sello de entidad, 1 year** | 260 € + IVA (**314,60 €**) | 1 year |
| **Sello de entidad, 2 years** | 330 € + IVA (**399,30 €**) — 165 €/año | 2 years |

Seal prices are from FNMT's *Precios de certificados de Componentes Año 2026 v2.0*. The list
prices only 1 and 2 years although the product page offers 1, 2 or 3.

### Getting a seal certificate

**Confirmed: available to private companies.** FNMT's request form offers two seal products and
describes this one as *"Este tipo de Certificado se emite para autenticar y crear sellos
electrónicos de personas jurídicas"*, distinct from the *Administraciones Públicas* seal. Avoid
the two *Curva Elíptica / Beta* options — the form itself says not to request them without prior
authorisation.

Portal: [apus20.cert.fnmt.es/SolicitudCertComp](https://apus20.cert.fnmt.es/SolicitudCertComp/)

1. **Generate the keypair and CSR on the target machine.** FNMT's procedure requires it —
   *"Esta operación deberá realizarse en una máquina del suscriptor"*, PKCS#10. Paste the CSR
   without its header and footer lines.
2. **Key usage.** The default already includes *autenticación de cliente*, which is exactly what
   the mTLS call to `www10`/`prewww10` needs. Do not deviate.
3. **The application generates a contract PDF** automatically from the form data.
4. **Sign the contract electronically.** *"La firma del contrato se realizará con un certificado
   de representante de persona jurídica expedido por la FNMT."* This is the step that makes a
   valid representante certificate a hard prerequisite for obtaining a seal.
5. **Send the documentation** to `registroceres@fnmt.es` — certificación registral of
   constitución y personalidad jurídica, CSV-verifiable, issued within the last **15 business
   days**.
6. FNMT emails a **código de solicitud** to both the entity and the representative. Retain it —
   needed for download and for telephone revocation.
7. **Pay, then download.** Payment precedes download.

Three consequences worth designing around:

- **FNMT never issues a `.p12`.** You supply the CSR and receive a certificate; the private key
  is born on your server and never moves. This closes the doc's former worry about whether a
  certificate can legally leave a browser or token for server use — for this product the
  question does not arise.
- **There is no renewal, but you can overlap.** *"No existe la renovación de certificados. Cuando
  el certificado haya caducado, se deberá solicitar uno nuevo."* Expiry means repeating the
  entire process, registry certification included. **The mitigation is in the same FNMT
  procedure:** *"No se contempla la autorevocación de certificados, por lo que se podrán tener
  activos dos o más certificados del mismo tipo, y para un mismo suscriptor."* Two live seals for
  one entity is permitted — so apply for the successor well before the incumbent expires and cut
  over with no gap. Asked how they handle this, mdiago said simply that they renew far in advance
  and swap one for the other, and therefore do not have the problem. Schedule on months of lead
  time, and the compliance question never arises.
- **No published contract template.** FNMT publishes contract PDFs for persona física and
  representante certificates but not for seals, so the wording cannot be reviewed in advance —
  only the Términos y Condiciones de Uso and the particular certification policies, both linked
  from the request form.

Contacts: `registroceres@fnmt.es` / 915 666 916–917–912 (registration), `comercial.ceres@fnmt.es`
/ 915 666 948 (pricing), `soporte_tecnico_ceres@fnmt.es` / 915 666 914 (technical).

### Getting a representante certificate

Four sequential phases: **Configuración Previa → Solicitud → Acreditar Identidad → Descargar**.
Download becomes available *"aproximadamente 1 hora después de que haya acreditado tu
identidad"*, so it cannot be done in one sitting.

**Which variant.** The `.11.1` *administrador único o solidario* route is dramatically cheaper in
effort: *"no requiere presentar ninguna documentación y puede obtenerse desde nuestra web con
nuestro certificado de persona física de la FNMT-RCM … o con el DNIe"* — FNMT queries the
Registro Mercantil itself. The general `.11.2` route requires accreditation at a registry office
or via the online route below.

**Lead-time shortcut:** *Acreditación On Line* is available **only for entities with NIF starting
A, B, C or D**, using an existing electronic certificate. No cita previa if you already hold a
personal FNMT certificate or DNIe — which matters a great deal for a non-resident applicant.

**Documentation** for `.11.2`:

- certificación registral of the entity's constitución y personalidad jurídica;
- certificación of the representative's nombramiento y vigencia del cargo — **or**, for
  representación voluntaria, a notarial poder containing FNMT's *cláusula especial* (Anexo I)
  covering request, download and use of the certificate;
- both issued within the last **15 business days**, CSV-verifiable.

> ⚠️ **Rule change, 1 July 2026.** FNMT no longer accepts *notas simples* of any kind — only a
> full certificación registral. FNMT's own documentation PDFs (v1.2) still say a stamped nota
> simple is valid; that text is stale. Verify with the Área de Registro before commissioning
> paperwork.

**Who qualifies.** FNMT's eligible list is administrador único/solidario, mancomunado,
administrador concursal, liquidador, consejero delegado, apoderado, **socio único**, presidente,
consejero — and anyone not holding a registered representative cargo needs *"poderes específicos
de representación con la cláusula especial"*. Being one shareholder among several confers
nothing.

**Board-governed companies.** Under LSC art. 233.2.d, where the órgano de administración is a
consejo, representation belongs to the consejo acting collegially unless the estatutos attribute
it individually or it is delegated to a consejero delegado. A non-executive chairman therefore
has no representation power by default. FNMT's documentation addresses this case directly:

> El órgano de representación es un Consejo de Administración sin consejero delegado. […] el
> Consejo tiene que adoptar un acuerdo para apoderar al presidente, o a cualquiera de sus
> miembros, […] con una cláusula especial para la solicitud, descarga y usos de certificados de
> firma electrónica (Anexo I). Este acuerdo se elevará a público mediante la correspondiente
> certificación expedida por secretario con el visto bueno del presidente.

Keep such a poder narrow — certificates and AEAT filings — rather than taking general
representation powers.

**Administradores mancomunados** cannot use the `.11.1` route at all, and FNMT requires the
minimum number of them to appear together for accreditation, or one to hold a poder with the
cláusula especial from the others.

**Renewal traps.** An expired FNMT certificate cannot be renewed — it needs a fresh application.
Persona física certificates renew online only *"durante los 60 días previos a la fecha de
caducidad"*, and a certificate that itself came from a renewal cannot be renewed online again.
Separately, the online `.11.1` route requires the identifying persona física certificate to be
one *"que no proceda de una renovación o haya sido solicitado con otro certificado"* — so obtain
any representante certificate **before** renewing the personal one that unlocks it.

---

## 2. Preproduction

Open access: *"de forma totalmente libre, con la única condición de autenticarse mediante un
certificado electrónico"*. No registration, no approval.

But: **no test NIFs, no test certificates, no self-signed certificates.** Preproduction still
validates NIFs against a census copy (error families 1109, 4102–4107), so the NIF must be real
and must match the certificate.

**You can test as yourself.** There is no requirement to be a client obligado tributario — your
own autónomo or company certificate works. Records go to a test database *"sin que en ningún
caso tengan trascendencia tributaria"*.

> AEAT prohibits mass or automated **load** testing against preproduction and warns that abusive
> use can get access blocked. Functional CI is fine; hammering it is not.

### Endpoint matrix

Two services × two environments × two certificate classes. All defined in one AEAT-hosted WSDL
(fetched from two hosts and byte-identical, 8780 bytes):

`https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl`

| Port | Environment | Cert | Endpoint |
| --- | --- | --- | --- |
| `SistemaVerifactu` | production | ordinary | `https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| `SistemaVerifactuSello` | production | **seal** | `https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| `SistemaVerifactuPruebas` | **preproduction** | ordinary | `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| `SistemaVerifactuSelloPruebas` | **preproduction** | **seal** | `https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |

`sfRequerimiento` (non-Veri\*Factu records supplied on AEAT demand) mirrors the same four hosts
with the `RequerimientoSOAP` path — eight ports total.

**Operations are `RegFactuSistemaFacturacion` and `ConsultaFactuSistemaFacturacion`.** Only two.

> Neither the sede page nor the developer page prints the endpoint strings — they live in the
> WSDL's `soap:address` bindings. Always fetch the AEAT-hosted WSDL; third-party mirrors drift.

### Portals and tools

- **Test portal** — [preportal.aeat.es](https://preportal.aeat.es). Veri\*Factu is one menu
  branch. Offers a web-service client (`ClienteWSAEAT_OPC`), AEAT's own invoicing app, and a
  record-query service — useful for cross-checking our output.
- **Informador VERI\*FACTU** virtual assistant — reachable from the sede hub under *Herramientas
  de asistencia virtual*. Navigate from the portal; the servlet path is not a stable URL.
- **QR cotejo service** and the **validation service for non-verifiable records** — listed on
  the sede *información técnica* page.

---

## 3. Going live

### No gate to pass

No homologación, no registry, no notification. Enforcement is **ex post** via LGT art. 201 bis
(up to 150.000 € for producing or marketing non-compliant software) — consistent with
self-certification, not a hidden ex-ante approval.

### Declaración responsable

Issued by the **producer**, never filed with AEAT. RD 1007/2023 art. 13.2:

> deberá constar por escrito y de modo visible en el propio sistema informático **en cada una de
> sus versiones**, así como para el cliente y el comercializador en el momento de la adquisición
> del producto.

AEAT requires it in **two places**:

1. **Inside the SIF** — *"accesible de forma rápida, fácil e intuitiva desde cualquier punto de
   acceso o terminal"* (a Help/About screen).
2. **Outside it** — before installation, *"en formato de uso ampliamente extendido y gratuito,
   como el texto puro, PDF o similar"*.

Content is fixed by RD 1007/2023 art. 13.4 and Orden HAC/1177/2024 art. 15: system
identification, code, version, type, composition, functionalities, installation characteristics,
producer identification and location, date and place of signature, and a statement of compliance
with LGT art. 29.2.j + RRSIF + the Orden.

**AEAT publishes worked examples** — *"Ejemplos de declaraciones responsables de sistemas
informáticos de facturación"*, V0.5.1 PDF, on the sede técnica page. Use these as the template.

**Every version is a distinct product**: *"Cada versión, por pequeña variación que introduzca, es
un producto distinto."* All versions' declarations must be retained.

No electronic signature is required on it: *"no se exige una firma electrónica del Productor."*

> 🟠 **Structural problem for a source-available POS — partially resolved 2026-07-26.** AEAT states
> third-party modifications are **not** covered by the original producer's certification. Read
> strictly, every fork, distro package and self-hosted customisation must issue its own DR.
>
> AEAT's FAQ now answers the open-source limb directly, and confirms the strict reading:
>
> > La empresa que efectúe la programación del código o integre partes de otro software, **ya
> > sea o no de código abierto**, debe realizar la declaración responsable.
>
> The obligation follows whoever programs or integrates. What this *does* resolve cleanly is the
> self-hosting case: *"Si el software hubiera sido desarrollado por la propia empresa, será esta
> la que deba certificarlo."* A company running software it developed for its own use issues its
> own DR and there is no producer/client split to manage. What remains open is the downstream
> fork question. See [asesor-questions.md Q9](asesor-questions.md) — still worth the consulta.

**Who does *not* issue one — verified 2026-07-27.** The duty attaches to production, not to use.
A business that acquires a complete SIF and runs it unmodified is a **cliente**: art. 13.2
requires the DR to be *"a disposición del cliente y del comercializador en el momento de la
adquisición del producto"* — they receive it, they do not author it. The four-way split is:

| Party | Duty |
| --- | --- |
| Producer of the SIF | Issues the DR, per version |
| Cliente / comercializador | Receives it at acquisition; issues nothing |
| Integrator building a SIF around someone else's component | Producer of *that* SIF → issues their own |
| Third party modifying an existing SIF | *"es necesario que incorporen su propia certificación"* |

Two consequences for the product. **Shipping a complete SIF rather than a library means our
clients owe no declaration of their own** — worth saying plainly in the sales material, because
competitors shipping components cannot say it. And it makes delivery of the DR at acquisition a
functional requirement, not just a compliance chore: it is the artefact that discharges the
client's position.

A second consequence of the producer being named in the declaration:

> ⚠️ **The DR names a natural person if there is no company.** Art. 13.4 requires *identificación
> del productor y su localización*. A producer trading as an individual carries LGT art. 201 bis
> exposure (up to 150.000 €) personally. This — rather than tax or optics — is the real trigger
> for incorporating before taking on unrelated clients.

### Who submits — the architecture decision

Two models, distinguished by *who authenticates to AEAT*. The choice has large consequences and
is worth making deliberately.

**Model A — producer only.** We build and certify the SIF; each client files under their own
certificate, which our software presents. `ObligadoEmision.NIF` is the client's, the certificate
holder is the client's representative, and error 4112 is satisfied on the *Obligado Emisión*
branch.

- Nothing to register with AEAT. No apoderamiento, no colaboración social.
- **No Spanish NIF, no certificate and no Spanish legal vehicle needed for the producer at all.**
  The declaración responsable requires the producer's identification and location; it does not
  require Spanish establishment. For a non-resident producer this removes an entire class of
  problem.
- The client's credential becomes per-tenant configuration rather than code.

**Model B — we submit on clients' behalf.** Requires our own qualified certificate, hence our own
Spanish NIF, hence a Spanish legal vehicle. Then per client, one of:

- **Apoderamiento** registered in AEAT's Registro de Apoderamientos — specific codes **`IZ862`**
  and **`IZ863`**, or the general Ley 58/2003 poder which subsumes both. The client grants it
  from the sede: *Registro de apoderamientos → Alta de poder para trámites tributarios
  específicos → Sistemas Informáticos de Facturación y VERI\*FACTU*.
- **Colaboración social** — **acuerdo Tipo 017**, contact **`comunicacion.sepri@correo.aeat.es`**.
  Veri\*Factu procedures were adapted to convenios 001, 002 and 017 as of 3 Feb 2025.

AEAT verbatim on the general permission:

> Para el envío de los Registros de facturación se puede utilizar cualquiera de las vías actuales
> de identificación admitidas por la AEAT, incluyendo la representación, el apoderamiento y la
> colaboración social, haciendo uso de un certificado cualificado por parte del tercero.

Two qualifications on Model B: it is **not automatic** — AEAT rejects submissions where the
convenio does not cover the trámite, or where no active apoderamiento exists (errors 4105/4112),
so enrol early. And it **never transfers liability**: *"esta posibilidad no exime al obligado a
expedir facturas de la responsabilidad sobre dicho cumplimiento."* We would absorb the
operational burden and the failure modes without relieving the client of anything.

**Decision: Model A.** Model B is a Spanish entity, a certificate, per-client apoderamientos and
an onboarding flow that chases every client through the AEAT sede — none of which the first
client needs. It is also purely additive later: the credential seam is identical and only the
presented identity changes.

**One consequence of Model A when we host.** The client's key then lives on our infrastructure. A
representante certificate is issued to a named natural person obliged to keep sole control of
it, which makes this an uncomfortable arrangement. Under a hosted Model A the client should hold
a **sello de entidad** — owned by the company, designed for machine custody. The seal stops being
an optional nicety and becomes the correct instrument.

> **Challenged 2026-07-27 — decision unchanged, but the crossover point is now an open
> question.** Asked about exactly this, mdiago replied that a SaaS provider *"debe formalizar un
> convenio con la AEAT (código 017) y manejar únicamente su propio certificado"* — i.e. Model B
> for hosted deployments, full stop.
>
> Their linked evidence does not carry that weight. The
> [discussion](https://github.com/mdiago/VeriFactu/discussions/154) answers a narrower question,
> and conditionally: convenio 017 is required *"si queréis enviar facturas en nombre de vuestros
> clientes **utilizando vuestro propio certificado**"*. That is the route **for Model B**, not a
> bar on Model A — and AEAT's own text above admits *"cualquiera de las vías actuales de
> identificación"*, including the obligado's own representation.
>
> **Model A stands for the first client.**
>
> Weigh the signal carefully, though, because it is not the signal it first appears to be.
> Irene Solutions *does* operate a hosted service — their free REST API, sold precisely on
> *"sin la complicación de preocuparnos de la gestión de certificados digitales"* — so this is
> very likely a description of how they actually run, not detached advice. That makes it
> stronger evidence than an opinion.
>
> But it is evidence about **a different product shape**. Their hosted offering is a *submission
> service* sitting behind someone else's invoicing system; ours is a *hosted SIF* where the
> tenant is the obligado. A transmission service naturally submits under its own identity, which
> is exactly what convenio 017 exists for. It does not follow that a hosted SIF must.
>
> Where the line sits is [asesor-questions.md Q11 and Q12](asesor-questions.md).

### Related-party constraint (Spanish SL clients)

Where a director of the client company also controls the producer, the supply is a related-party
transaction. Under **LSC art. 220** any *"relaciones de prestación de servicios o de obra"*
between an SL and one of its administradores requires a **junta general** resolution — not a
board one — and **art. 231** extends this to entities the director controls, so interposing a
company does not avoid it. Arts. 228–229 add the duty of loyalty: disclose and abstain.

Approve before the first contract, and document the terms. Gratuity is not an obvious exemption:
an approved free arrangement costs nothing, an unapproved one is a loose thread on the system
that produces the company's legally-mandated invoice records.

---

## 4. Resolved and still unverified

### Closed on 2026-07-26

- ~~**Seal certificate cost.**~~ 260 € + IVA (1 year) / 330 € + IVA (2 years), from FNMT's 2026
  componentes price list. **Lead time remains unverified** — FNMT publishes no SLA, and the
  process has a payment step and a manual registry validation in the middle of it.
- ~~**Certificate format and server use.**~~ The seal is **CSR-based**: the keypair is generated
  on the subscriber's own machine and FNMT never sees or issues a private key. Export is a
  non-question. Representante certificates carrying `0.4.0.194112.1.0` (QCP-n, not QSCD) are
  software certificates and exportable as `.p12`. **Only the QSCD variants would be a problem.**
- ~~**Whether a private company can obtain an FNMT seal.**~~ Yes — *"sellos electrónicos de
  personas jurídicas"*, a distinct product from the Administraciones Públicas seal.
- ~~**Residency requirements** (partially).~~ A non-resident NIE holder can hold FNMT persona
  física and representante certificates, and the *Acreditación On Line* route (NIF A/B/C/D)
  removes the need to appear in Spain. Nationality was never the constraint; **representation
  capacity** is.

### Still unverified

- **Seal certificate lead time**, as above.
- **No CA other than FNMT was researched** — Camerfirma (250 € + IVA list price for a seal),
  ANF AC, Firmaprofesional, Uanataca. Any @firma-validated qualified seal should be acceptable;
  none was verified against Veri\*Factu specifically.
- **`tipos 4 y 8`** comes from FNMT and an SII-scoped AEAT FAQ, not from Veri\*Factu-specific
  AEAT prose — the developer FAQ v1.3 contains zero hits for "sello" or "www10".
- **Whether a non-resident NIE is reliably "identificado en el censo"** for `ObligadoEmision`
  purposes (errors 4107/1109). Not tested; avoid depending on it by testing with the obligado's
  own certificate.
- **The downstream-fork limb of the source-available DR question** above.
- **Whether the FNMT documentation PDFs' stale *nota simple* wording** or the 1 July 2026
  certificación-registral rule is what the Área de Registro actually enforces this month.

---

## Sources

AEAT sede *información técnica* and *certificación* pages (updated 26 March 2026); AEAT-hosted
`SistemaFacturacion.wsdl`; [preportal.aeat.es](https://preportal.aeat.es); AEAT developer FAQ
v1.3 (4 Dec 2025); FNMT-RCM Ceres price list and product pages; BOE-A-2023-24840 (RD 1007/2023
arts. 13); BOE-A-2024-22138 (Orden HAC/1177/2024 art. 15); LGT art. 201 bis.

Added 2026-07-26:

- [FNMT Sello de Entidad](https://www.cert.fnmt.es/componente/sello-entidad) and the
  [componentes request portal](https://apus20.cert.fnmt.es/SolicitudCertComp/)
- FNMT *Precios de certificados de Componentes Año 2026 v2.0* and
  [*Certificados de componente* v1.05](https://www.cert.fnmt.es/documents/10446703/10511896/Certificados_de_componente_v1.05.pdf)
- [FNMT procedimiento de registro — certificados de sello de entidad](https://www.cert.fnmt.es/documents/10446703/10887586/ci_pr_selloentidad_+v1.0.pdf)
- [FNMT perfiles AC Representación](https://www.cert.fnmt.es/documents/10445900/10575386/perfiles_certificados_ac_representacion.pdf)
  (policy OID map) and [documentación entidades NIF A y B](https://www.cert.fnmt.es/documents/10445900/10798644/Documentacion_AB/d8a982ea-f1bc-42c8-6c21-ff22e1a97965?version=1.3)
- [FNMT: certificados válidos para VERI\*FACTU](https://www.sede.fnmt.gob.es/preguntas-frecuentes/certificado-de-representante/-/asset_publisher/eIal9z2VE0Kb/content/certificados-electr%C3%B3nicos-v%C3%A1lidos-para-el-sistema-veri*factu)
- AEAT Veri\*Factu error-code list (4102–4137, 1100–1178)
- [AEAT FAQ — declaración responsable](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html)
  and [cumplimiento y delegación](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/cuestiones-generales-cumplimiento-delegacion.html)
- [AEAT Registro de apoderamientos](https://sede.agenciatributaria.gob.es/Sede/colaborar-agencia-tributaria/registro-apoderamientos.html)
- Real Decreto-ley 15/2025 (BOE, 2 Dec 2025) via the
  [consolidated RD 1007/2023](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840)
- LSC arts. 220, 228–231, 233
