# What to do next — the checklist

Written **2026-07-26**. Plain action list; the reasoning and sources are in
[getting-to-production.md](getting-to-production.md).

---

## The situation in five lines

- **Waitron is the producer** of the invoicing software. It issues the declaración responsable.
- **Santet Deli Co SL is the obligado** — the taxpayer whose invoice records get filed.
- **The deli files under its own certificate.** Waitron never authenticates to AEAT as itself.
- **The deli's deadline is 1 January 2027.** Waitron's producer deadline already passed
  (29 July 2025).
- **Your personal certificate has no role in any of this.** It is fine and needs nothing.

---

## Step 1 — Get the deli's certificate confirmed *(blocks everything)*

Ask the gestor for the SL's current certificate and check it:

```bash
openssl pkcs12 -in deli.p12 -clcerts -nokeys -legacy | \
  openssl x509 -noout -subject -issuer -dates -ext certificatePolicies
```

It must show:

| Check | Expected |
| --- | --- |
| `notAfter` | in the future |
| `issuer` | `O=FNMT-RCM … CN=AC Representación` |
| `subject` | `O=SANTET DELI CO SL`, `organizationIdentifier=VATES-B13817952` |
| policy | `1.3.6.1.4.1.5734.3.11.1` or `.11.2` |

The old one (titular David Stewart Kalucy, issued 12 July 2023) **expired on 12 July 2025** and
cannot be renewed — an expired FNMT certificate always needs a fresh application.

Until a valid one exists, nothing can be tested against AEAT.

## Step 2 — Order the deli's sello de entidad

**Cost: 260 € + IVA for 1 year, 330 € + IVA for 2 years** (314,60 € / 399,30 €).

Why bother, when the certificate from step 1 already works? Because Waitron will host the
deli's system. A representante certificate belongs to a named person who must keep sole
control of the key; a sello belongs to the company and is *designed* for a machine to hold.
Once Waitron is a separate business, running the deli's filings off a director's personal key
is the wrong shape.

1. Get a **certificación registral** from the Registro Mercantil (constitución y personalidad
   jurídica), CSV-verifiable, **issued within the last 15 business days**. Notas simples are no
   longer accepted — that changed on 1 July 2026.
2. Generate a keypair and CSR **on the server that will use it**. The private key never leaves
   your machine; FNMT only ever sees the CSR.
3. Go to [apus20.cert.fnmt.es/SolicitudCertComp](https://apus20.cert.fnmt.es/SolicitudCertComp/)
   → *Certificados cualificados de sello electrónico* → *Solicitar emisión*.
4. Choose **"Certificado de sello de entidad"**. Not the *Administraciones Públicas* one, and
   not either of the *Curva Elíptica / Beta* options.
5. Keep the default key usage — it includes *autenticación de cliente*, which is what the
   connection to AEAT needs. Paste the CSR without its `BEGIN`/`END` lines.
6. The site generates a contract PDF. **Whoever holds the certificate from step 1 signs it
   electronically** — this is the only reason step 1 blocks step 2.
7. Email the registry documentation to `registroceres@fnmt.es`.
8. FNMT emails a *código de solicitud* — **save it**; you need it to download, and again if you
   ever have to revoke by phone.
9. Pay, then download.

Questions to `registroceres@fnmt.es` / 915 666 916 (registration) or `comercial.ceres@fnmt.es`
(pricing).

**Note for later:** a sello **cannot be renewed** — when it expires you repeat this whole
process, registry certificate included. But FNMT permits *"dos o más certificados del mismo tipo,
y para un mismo suscriptor"* to be active at once, so the fix is to **apply for the replacement
months early and overlap them**, never to let one lapse. Put it on the scheduler with months of
warning, not days.

## Step 3 — Get junta general approval before Waitron does any work for the deli

You are a director of the deli and Waitron is yours. Under LSC art. 220 any service
arrangement between an SL and one of its administradores needs a **shareholders' meeting**
resolution — not a board one. Art. 231 extends this to companies you control, so incorporating
Waitron later doesn't avoid it.

- Approve it **before** the first contract, not retrospectively.
- Write down the terms. If Waitron supplies the deli free as first/reference client, say that
  explicitly — free doesn't obviously exempt it, and an approved free arrangement costs nothing.
- Disclose the conflict and abstain from the vote (LSC arts. 228–229).

With three shareholders this is a short meeting, but it wants doing properly once.

## Step 4 — Diarise 7 May 2027: renew your personal certificate

Yours expires **6 July 2027**. FNMT only allows online renewal in the **60 days before expiry**.
Miss it and you re-accredit your identity in person, by video, or with a DNIe you don't have.

Renewal is also one-shot: a renewed certificate can't be renewed online again.

## Step 5 — Decide before July 2027 whether you want your own certificate for the deli

You don't need one for anything above. You'd want one only to run the deli's AEAT side yourself
— ordering certificates, querying records on the sede, correcting submissions — instead of
going through the gestor.

If you do want one, **get it before you renew your personal certificate**, because FNMT's
online routes require the identifying certificate to be an original, not a renewal.

As non-executive chairman you have no representation power by default (LSC art. 233.2.d — with
a board, representation belongs to the board acting collectively). Two ways round it:

- **Check the estatutos first.** They may already give the presidente individual representation.
  If so, it's just the registry paperwork. Ten minutes of the gestor's time to find out.
- **Otherwise, a board resolution** empowering the chairman, containing FNMT's *cláusula
  especial*, certified by the secretary with your V°B° and elevated to público. FNMT's own
  documentation names the chairman as the default choice here. Keep the powers narrow —
  obtaining and using certificates, AEAT filings — not general representation.

## Step 6 — Incorporate Waitron before it has a second client

The declaración responsable must name the producer. Today that producer is **you personally**,
which puts LGT art. 201 bis exposure (up to 150.000 €) on you rather than on a company. With
one client that is your own SL, that's contained. Before an unrelated client, it isn't.

This — not tax, not optics — is the trigger for forming the company.

## Step 7 — Send mdiago the ERP-modules FAQ *(small, and we owe it)*

He answered every question we sent and asked for one thing
back: the text of the AEAT ERP-modules FAQ that question 2 rests on, which he could not locate.
We offered reciprocity in the message. Send it.

## Step 8 — Write the declaración responsable

Needed before anyone else uses the software; already overdue in principle, since the producer
deadline passed on 29 July 2025.

- Use [AEAT's worked examples](https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf)
  as the template.
- Publish it in **two places**: inside the app (a Help/About screen, reachable from any
  terminal) and outside it as a PDF or plain text available before installation.
- **One per version.** Every release is legally a distinct product. Keep them all.
- No signature required.

---

## What you do *not* need to do

- ❌ Register Waitron with AEAT. There is no registry and no homologación.
- ❌ File the declaración responsable anywhere. It is published, never submitted.
- ❌ Get a certificate for Waitron, or a Spanish NIF for it, or any legal vehicle — as long as
  Waitron only produces the software and the deli files under its own credential.
- ❌ Colaboración social (acuerdo Tipo 017) or apoderamientos (`IZ862`/`IZ863`). Those are only
  for submitting *on behalf of* clients, which this design deliberately avoids.
- ❌ Change your personal certificate in any way.

---

## Costs

| Item | Cost |
| --- | --- |
| Sello de entidad, 1 year | 260 € + IVA (**314,60 €**) |
| Sello de entidad, 2 years | 330 € + IVA (**399,30 €**) |
| Representante de persona jurídica (if you want one) | 14 € + IVA (16,94 €) |
| Certificación registral | Registry fee, per request |
| Notary, if a board resolution is needed | Per notary |
| AEAT preproduction access | Free |
| Homologación / certification | Does not exist |

---

## Order of play

```text
Step 1 (gestor's cert)  ──▶  Step 2 (sello)  ──▶  AEAT preproduction
Step 3 (junta)          ──▶  Waitron works for the deli
Step 4, 5 (certs)       ──▶  independent, deadline July 2027
Step 6 (incorporate)    ──▶  before client #2
Step 7 (mdiago FAQ)     ──▶  whenever; we owe it
Step 8 (DR)             ──▶  before anyone else uses it
```

Only step 1 is on the critical path.
