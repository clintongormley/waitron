# First real AEAT submission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get one real sale from the deli's till to the Agencia Tributaria's pre-production environment, using the real certificate, and read what comes back.

**Architecture:** No new product code. `apps/server` already resolves a per-tenant certificate from the credential vault, builds an mTLS transport from it, picks the AEAT endpoint from `certKind` + `WAITRON_AEAT_ENV`, and drains pending `envios`. This plan adds two throwaway-shaped artifacts (a read-only pre-production probe, a one-sale script), one committed operational artifact (`bootstrap-tenant.sql`), and then runs the system for real.

**Tech Stack:** TypeScript (ESM), Vitest, undici (mTLS `Agent`), Drizzle, PostgreSQL, AEAT SOAP over `prewww1.aeat.es`.

**Spec:** [`2026-07-28-first-aeat-submission-design.md`](../specs/2026-07-28-first-aeat-submission-design.md).

## Global Constraints

- **Every commit signed off**: `git commit -s`. The `dco` job walks every commit in the PR range.
- **The gate is four commands**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** for anything that starts a container.
- **The `.p12` file, its passphrase, and the credential key ring NEVER appear** in a commit, a command argument, a shell history entry, a test fixture, or a Claude transcript. Secrets reach a process through stdin, or through an environment variable set from a silent prompt (`printf` + `stty -echo` + `read -r` — portable; **never bash's `read -p`, which fails in zsh with "no coprocess"**), and nothing else.
- **Pre-production only.** `WAITRON_AEAT_ENV=preproduction`. No step in this plan may target `production`; switching is a separate, human decision.
- **The probe is read-only.** It calls `consultar`, never `submit`. A query files nothing.
- **Nothing invents the deli's real data.** The NIF, legal name, address and series code come from the human. A test NIF must never reach AEAT.

### Steps a subagent cannot perform

Tasks 2, 3 and 4 include steps that need the certificate file, its passphrase, or a decision about real fiscal data. Those are marked **[HUMAN]**. A subagent reaching one must stop and report, not improvise. Everything else is ordinary code work.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `apps/server/src/aeat.preprod.test.ts` | Read-only probe: one mTLS `consultar` against AEAT pre-production |
| `apps/server/vitest.preprod.config.ts` | Runs only the probe; never part of `pnpm test` |
| `apps/server/sql/bootstrap-tenant.sql` | The deli's tenant, location, till and invoice series |
| `apps/server/scripts/record-one-sale.ts` | Records exactly one real sale through `@waitron/core` |
| `docs/compliance/first-aeat-contact.md` | What AEAT actually did, written as it happens |

**Modified:** `apps/server/vitest.config.ts` (exclude the probe), `apps/server/package.json` (a `test:preprod` script).

---

## Task 1: The read-only pre-production probe

The scariest unknown, isolated: does an exported `representante` key work unattended against AEAT at all? Nothing else in this plan is worth doing until this answers.

**Files:**

- Create: `apps/server/src/aeat.preprod.test.ts`
- Create: `apps/server/vitest.preprod.config.ts`
- Modify: `apps/server/vitest.config.ts`, `apps/server/package.json`

**Interfaces:**

- Consumes: `mtlsFetch(material: CertMaterial, ca?: string): TenantTransport` and `type CertMaterial = { pfx: Buffer; passphrase: string; certKind: CertKind }` from `apps/server/src/aeat-transport.ts`; `createClient({ endpoint, fetch })` and `SOAP_ENDPOINTS` from `@waitron/verifactu`.
- Produces: nothing other packages consume. This is a diagnostic.

- [ ] **Step 1: Exclude the probe from the normal run**

`apps/server/vitest.config.ts` — add the probe to the existing `exclude`, mirroring how `packages/payments-stripe/vitest.config.ts` excludes `"src/**/*.sandbox.test.ts"`:

```ts
exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.preprod.test.ts"],
```

A probe that talks to a tax authority must never run in CI or from a bare `pnpm test`.

- [ ] **Step 2: Add its own config and script**

Create `apps/server/vitest.preprod.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// The AEAT pre-production probe, run deliberately and never by `pnpm test`. Same shape as
// packages/payments-stripe/vitest.sandbox.config.ts: a real external service, real credentials,
// no coverage thresholds, and a timeout that tolerates a government SOAP endpoint.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.preprod.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

In `apps/server/package.json`'s `scripts`, beside `test`:

```json
"test:preprod": "vitest run --config vitest.preprod.config.ts",
```

- [ ] **Step 3: Write the probe**

Create `apps/server/src/aeat.preprod.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SOAP_ENDPOINTS, createClient } from "@waitron/verifactu";
import { mtlsFetch } from "./aeat-transport.js";

// Supplied by the operator at run time, never committed and never defaulted. Absent means the
// suite has nothing to prove, so it skips rather than inventing material.
const pfxBase64 = process.env.WAITRON_PREPROD_PFX_BASE64;
const passphrase = process.env.WAITRON_PREPROD_PFX_PASSPHRASE;
const nif = process.env.WAITRON_PREPROD_NIF;
const nombre = process.env.WAITRON_PREPROD_NOMBRE;

const configured =
  pfxBase64 !== undefined && passphrase !== undefined && nif !== undefined && nombre !== undefined;

describe.runIf(configured)("AEAT pre-production, real certificate", () => {
  it("completes an mTLS handshake and answers a consulta", async () => {
    const transport = mtlsFetch({
      pfx: Buffer.from(pfxBase64!, "base64"),
      passphrase: passphrase!,
      certKind: "representante",
    });
    const client = createClient({
      endpoint: SOAP_ENDPOINTS.preproduction,
      fetch: transport.fetch,
    });

    // `consultar`, never `submit`: a query files nothing. This proves the certificate, the TLS
    // chain, the endpoint, the SOAP envelope and the response parser — everything except the act
    // of filing — and it is safe to run repeatedly.
    const respuesta = await client.consultar(
      { ObligadoEmision: { NombreRazon: nombre!, NIF: nif! } },
      { Ejercicio: "2026", Periodo: "07" },
    );

    // Deliberately weak: ANY parsed response means the whole chain worked. An empty result is a
    // success — this obligado has filed nothing yet, which is exactly the expected state.
    expect(respuesta).toBeDefined();
    console.log("AEAT consulta response:", JSON.stringify(respuesta, null, 2));
  });
});
```

- [ ] **Step 4: Confirm it is excluded from the normal run**

```bash
pnpm --filter @waitron/server test 2>&1 | grep -c "preprod" || echo "correctly excluded"
pnpm lint && pnpm typecheck && pnpm format:check
```

Expected: the probe does not appear; the gate is clean. The suite still reports its usual 12 files.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/aeat.preprod.test.ts apps/server/vitest.preprod.config.ts \
        apps/server/vitest.config.ts apps/server/package.json
git commit -s -m "test(server): a read-only AEAT pre-production probe

consultar, never submit — a query files nothing, so this is safe to run
repeatedly while we find out whether an exported representante key works
unattended at all. Excluded from pnpm test and from CI."
```

- [ ] **Step 6: [HUMAN] Run it against the real certificate**

```bash
# Portable across zsh and bash. zsh's `read -p` means "read from a coprocess", not
# "prompt", so the bash spelling fails outright on this repo's default shell.
printf 'PFX passphrase: '; stty -echo
read -r WAITRON_PREPROD_PFX_PASSPHRASE; stty echo; echo
export WAITRON_PREPROD_PFX_PASSPHRASE
export WAITRON_PREPROD_PFX_BASE64="$(base64 -i /path/to/cert.p12)"
export WAITRON_PREPROD_NIF="<the deli's NIF>"
export WAITRON_PREPROD_NOMBRE="<the deli's legal name>"
pnpm --filter @waitron/server test:preprod
unset WAITRON_PREPROD_PFX_PASSPHRASE WAITRON_PREPROD_PFX_BASE64
```

**Record the exact outcome** — success, TLS error, HTTP status, or SOAP fault — in `docs/compliance/first-aeat-contact.md` (Task 5). This single result determines whether the rest of the plan is worth running:

| Outcome | Meaning |
| --- | --- |
| A parsed response | The certificate works unattended. Continue. |
| TLS handshake failure | The key may be non-exportable in practice, or the chain needs an intermediate. Stop and diagnose before Task 2. |
| HTTP 403 / SOAP fault about the certificate | The certificate is not registered for this service. That is a procurement/registration problem, not a code one. |
| Timeout | Check whether `prewww1.aeat.es` is reachable at all from this network. |

---

## Task 2: A real database with the deli in it

**Files:**

- Create: `apps/server/sql/bootstrap-tenant.sql`

**Interfaces:**

- Produces: one `tenants` row (the deli), one `locations`, one `tills`, one `invoice_series` — their ids are read back by Tasks 3 and 4.

- [ ] **Step 1: Write the bootstrap script**

Create `apps/server/sql/bootstrap-tenant.sql`. Values arrive as `psql` variables so the committed file carries no business data and can be reused for a second deli:

```sql
-- The deli's own rows. Run ONCE, by hand, against a migrated database, as a SUPERUSER (or a role
-- with BYPASSRLS) — NOT merely as the table owner. Every table this script writes has FORCE ROW
-- LEVEL SECURITY, which denies the owner its usual RLS exemption, and the first INSERT creates the
-- very tenant whose id app.tenant_id would need to be set to. Confirmed live: a non-superuser role
-- made owner of all four tables is denied on the tenants INSERT.
--
-- Deliberately NOT the test seeds: packages/db/src/testing/seed.ts writes 'Test SL' and a NIF from
-- a counter. Those values would become part of a fiscal record the Agencia Tributaria keeps.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v nif="B12345678" -v legal_name="Deli SL" -v location_name="Mostrador" \
--     -v operation_description="Venta en establecimiento" -v till_name="Caja 1" \
--     -v series_code="A" -v locale="es-ES" \
--     -f apps/server/sql/bootstrap-tenant.sql
\set ON_ERROR_STOP on

begin;

insert into tenants (nif, legal_name)
values (:'nif', :'legal_name')
returning id as tenant_id \gset

insert into locations (tenant_id, name, invoice_locales, operation_description)
values (:'tenant_id', :'location_name', array[:'locale'], :'operation_description')
returning id as location_id \gset

insert into tills (tenant_id, location_id, name)
values (:'tenant_id', :'location_id', :'till_name')
returning id as till_id \gset

insert into invoice_series (tenant_id, till_id, code)
values (:'tenant_id', :'till_id', :'series_code')
returning id as series_id \gset

commit;

\echo 'tenant_id:' :tenant_id
\echo 'till_id:  ' :till_id
\echo 'series_id:' :series_id
```

- [ ] **Step 2: Prove the script against a throwaway container first**

Never debug SQL against the real database. Start a container, migrate it, run the script with placeholder values, confirm four rows:

**There is no migrate-only mode.** `apps/server/src/bin.ts` reads no argv, and `boot.ts` applies
migrations during startup. A database is therefore migrated by **booting the host against it once**
and stopping it — which is also how the deli's database gets migrated in Step 4, so proving it here
proves that too.

```bash
docker run -d --name waitron-bootstrap-probe \
  -e POSTGRES_PASSWORD=probe -p 55432:5432 postgres:18-alpine
export PROBE_URL="postgresql://postgres:probe@127.0.0.1:55432/postgres"
pnpm --filter @waitron/server build

# A THROWAWAY key ring, discarded with the container — never the deli's, which Step 4 generates and
# keeps. `boot.ts` calls loadKeyRing BEFORE applyMigrations, so without one the host exits on
# `credentials.key_missing` and never migrates at all (observed while proving Step 4b).
export WAITRON_CREDENTIALS_KEY="$(openssl rand -base64 32)"
export WAITRON_CREDENTIALS_KEY_VERSION=1

# Boots, migrates, then idles on its duty loop. Stop it once /health answers.
DATABASE_URL="$PROBE_URL" WAITRON_AEAT_ENV=preproduction node apps/server/dist/server.js &
HOST_PID=$!
until curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; do sleep 1; done
kill "$HOST_PID"

psql "$PROBE_URL" -v nif="B00000000" -v legal_name="Probe SL" -v location_name="Mostrador" \
  -v operation_description="Venta" -v till_name="Caja 1" -v series_code="A" -v locale="es-ES" \
  -f apps/server/sql/bootstrap-tenant.sql
psql "$PROBE_URL" -c "select (select count(*) from tenants) t, (select count(*) from locations) l,
                             (select count(*) from tills) ti, (select count(*) from invoice_series) s"
docker rm -f waitron-bootstrap-probe
```

Expected: `1 | 1 | 1 | 1`. If `/health` returns 503 rather than 200 that is fine and expected — no
certificate is provisioned on this throwaway database, so every drain pass skips its tenant, which
is precisely the degraded state this whole cycle exists to end. Migrations still ran.

**Record as a finding:** an operator provisioning a database has no way to run migrations without
also starting the duty loop. Not a blocker, and not this cycle's job to fix — but Task 5 should note
it, because the next person will look for a `--migrate-only` flag and not find one.

- [ ] **Step 3: Commit**

```bash
git add apps/server/sql/bootstrap-tenant.sql
git commit -s -m "feat(server): bootstrap SQL for a real tenant

Values as psql variables so the committed file carries no business data. Not
the test seeds: those write 'Test SL' and a counter NIF, and these rows become
part of a fiscal record."
```

- [ ] **Step 4: [HUMAN] Create the real database and apply the grant recipe**

The deli's database, following `apps/server/README.md`'s "Database roles and grants" — this is that recipe's **first real use**, and it is recorded there as hand-verified rather than test-covered. Any step that does not work as written is a finding for Task 5 and a fix to that README in this cycle.

**Generate the credential key ring FIRST.** `boot.ts` calls `loadKeyRing(env)` (line 96) *before*
`applyMigrations` (line 104), so the host will not even migrate without it — confirmed by observation
while proving Step 4b: with neither variable set, the host dies on `credentials.key_missing` inside
`startServer` and the database is left unmigrated. This is the deli's own key, generated once here
and kept for the life of the deployment. Task 2 Step 2 generates a **separate throwaway** one that
dies with its container; the two are deliberately not the same key.

```zsh
export WAITRON_CREDENTIALS_KEY="$(openssl rand -base64 32)"
export WAITRON_CREDENTIALS_KEY_VERSION=1
```

**Losing this key makes every sealed credential unrecoverable.** Store it wherever the deployment's
secrets live before going further.

Then migrate by booting the host against the database once, exactly as Step 2 did with the throwaway
container, and run `bootstrap-tenant.sql` with the deli's real values. Keep the printed `tenant_id`
— Tasks 3 and 4 need it.

- [ ] **Step 5: [HUMAN] Send the certificate-kind question to the fiscal advisor**

Append to [`docs/compliance/asesor-questions.md`](../../compliance/asesor-questions.md): the deli holds a *representante* certificate, so every Veri*Factu submission is signed by a natural person acting for the entity rather than by the entity's own seal. Ask whether that is acceptable for continuous unattended submission, or whether a *certificado de sello* is required.

It does not block anything — the code already supports both, and `SOAP_ENDPOINTS_SELLO` exists for the other answer — but the question should be in flight before production is discussed, not after.

---

## Task 3: Provision the certificate

**Files:** none. This task produces a database row, not a file.

- [ ] **Step 1: Build the credentials CLI**

```bash
pnpm --filter @waitron/credentials build
```

`packages/credentials`'s `bin` entry points at `./dist/bin.js`, which does not exist in a fresh
checkout — `pnpm install` warns about exactly this. Without the build, the next step fails with
"command not found".

- [ ] **Step 2: [HUMAN] Confirm the credential key ring is set**

Task 2 Step 4 already generated this — `boot.ts` reads the key ring before it runs migrations, so
the database could not have been migrated without it. **Use that same key**; a second one would seal
this credential where the host cannot read it. Confirm it is still exported in this shell:

```zsh
[[ -n "$WAITRON_CREDENTIALS_KEY" && -n "$WAITRON_CREDENTIALS_KEY_VERSION" ]] \
  && echo "key ring: set (version $WAITRON_CREDENTIALS_KEY_VERSION)" \
  || echo "NOT SET — re-export the SAME key from Task 2 Step 4, never a new one"
```

- [ ] **Step 3: [HUMAN] Seal the certificate into the vault**

```bash
# Portable across zsh and bash — zsh's `read -p` reads from a coprocess, not a prompt.
printf 'PFX passphrase: '; stty -echo; read -r PFX_PASS; stty echo; echo
jq -n --arg pfx "$(base64 -i /path/to/cert.p12)" \
      --arg pass "$PFX_PASS" \
      --arg kind representante \
   '{pfxBase64: $pfx, passphrase: $pass, certKind: $kind}' \
 | DATABASE_URL="$DELI_DATABASE_URL" pnpm --filter @waitron/credentials exec waitron-credentials \
     set --tenant "$TENANT_ID" --purpose fiscal.aeat
unset PFX_PASS
```

The payload goes in on **stdin**: the CLI refuses a payload as an argument (there is a test pinning that), and it has no `get` command, so nothing can print it back out.

- [ ] **Step 4: [HUMAN] Confirm it landed without printing it**

```bash
DATABASE_URL="$DELI_DATABASE_URL" pnpm --filter @waitron/credentials exec waitron-credentials \
  list --tenant "$TENANT_ID"
```

Expected: one `fiscal.aeat` row for that tenant. The tool never prints the payload — that is the design, not a limitation.

---

## Task 4: One real sale, and the drain that submits it

**Files:**

- Create: `apps/server/scripts/record-one-sale.ts`

**Interfaces:**

- Consumes: `recordSale(tx, backend, input)` from `@waitron/core`; the Veri*Factu backend from `@waitron/fiscal-verifactu`; `withTenant` and `createPostgresDb` from `@waitron/db`.

- [ ] **Step 1: Read the two files that show how this is really done**

Before writing anything, read:

- `packages/fiscal-verifactu/src/write-path.e2e.test.ts` — the only place in the repo that drives `recordSale` through the *real* Veri*Factu backend end to end. Mirror its backend construction exactly; do not invent options.
- `packages/core/src/record-sale.ts`'s `RecordSaleInput` type — every field is required by a CHECK constraint or by the law, and guessing produces a rejected filing rather than a compile error.

This step exists because `VerifactuBackendOptions` has many construction sites and the wrong one silently produces a different chain. Report in your own words what the backend needs before continuing.

- [ ] **Step 2: Write the script**

Create `apps/server/scripts/record-one-sale.ts`, taking tenant, till and series ids plus the sale's amounts from argv, opening one transaction, and calling `recordSale` through the real backend — mirroring `write-path.e2e.test.ts`. It must:

- read `DATABASE_URL` from the environment, never take a connection string as an argument;
- run inside `withTenant(db, tenantId, …)` so RLS applies exactly as it will in production;
- print the returned `saleId` and `FiscalRecordRef`;
- do nothing else. It is not a till.

- [ ] **Step 3: Prove it against a throwaway container**

Run it against a fresh migrated container with placeholder ids and confirm it produces one `sales` row, one chained fiscal record, and one pending `envios` row:

```bash
psql "$PROBE_URL" -c "select count(*) from sales; select count(*) from envios where estado='pendiente'"
```

Expected: `1` and `1`. **Do not run it against the deli's database yet.**

- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/record-one-sale.ts
git commit -s -m "feat(server): a script that records exactly one real sale

There is no till application yet, so this is the only way to put a real sale
into the chain. Mirrors write-path.e2e.test.ts's backend construction."
```

- [x] **Step 4b: The till must be registered as a SIF first — and nothing does that yet**

**Discovered while proving Task 4 against a throwaway container.** `VerifactuBackend.recordSale`
reads the till's live SIF identity via `currentSif`, which throws `sif.not_registered` when no
`registro_sif` row exists. `registerSif` exists in `@waitron/fiscal-verifactu` and is exported from
its barrel — but **it has no production caller anywhere in this repository**. Every reference
outside `registro-sif.ts` is a doc comment; only tests and fixtures invoke it.

So a till created by `bootstrap-tenant.sql` cannot record a sale. Step 5 fails immediately without
this.

**Do not paper over it with raw SQL.** `registerSif` mints the installation number through a
counter with real contention semantics (proven under 20 concurrent writers in
`chain.concurrency.test.ts`), and re-registration deliberately begins a new chain. A hand-written
INSERT would produce a `registro_sif` row that looks right and chains wrong.

**Done.** Split across two files rather than the single script this step first described:

- `apps/server/src/provision-till.ts` — `provisionTill(db, { tenantId, tillId, idSistemaInformatico })`,
  covered by `src/provision-till.test.ts` against a real schema on PGlite. It lives in `src/` because
  `vitest.config.ts` excludes `scripts/**` from coverage as *build tooling*, and provisioning a till
  is behaviour this host owns. It is also the seed of the provisioning surface this step's own
  closing note calls for.
- `apps/server/scripts/register-till.ts` — the argv/stdout shim, a third esbuild target in `build`.

Two departures from the sketch above, both deliberate:

1. **The NIF is not an argument.** It is read from the tenant row. `sif.nif` becomes
   `ObligadoEmision.NIF` and `IDEmisorFactura` on every registro the till ever files
   (`backend.ts:475`, `:231`), so an operator-supplied NIF is a way to file one tenant's sales under
   another's with nothing in the database disagreeing. The fixtures that pass `nif` to `registerSif`
   mint the tenant in the same breath; a provisioning tool has an existing tenant to read it from.
2. **The till is checked against `tills.tenant_id` explicitly.** `registro_sif` has separate foreign
   keys onto `tenants` and `tills` and no composite one, and RLS's WITH CHECK only constrains
   `tenant_id` — so a row naming tenant A with a till of tenant B satisfies every constraint in the
   schema. Leaning on RLS to hide the foreign row would not hold for the superuser who provisions the
   first till of a deployment. The two misses report `tenant.not_found` and `till.not_found`.

The suite runs on PGlite rather than a container, against this package's grain. `startRealPostgres`'s
own refusal message justifies itself by "PGlite runs every connection as a superuser, so it cannot
show whether this host works as the non-superuser deployment role" — and nothing in this suite leaves
the superuser connection, so that justification does not apply.

It is **not** a stronger harness, and an earlier draft of this paragraph claimed it was. A mutant
that drops the ownership guard dies on PGlite and on a superuser container alike, since neither
applies RLS. The narrower true statement: dropping only the `eq(tills.tenantId, …)` predicate would
survive on a container connected as the *deployment role*, because RLS hides the foreign till
anyway — and no suite here connects that way. Verified by deletion on PGlite.

**Proven against a throwaway container**, in the order that makes the gap visible:

| | |
| --- | --- |
| `record-one-sale` before registering | fails, `sif.not_registered` — the gap, reproduced |
| `register-till` | `numeroInstalacion: 1`, `nif: B00000000` (the tenant's own, unprompted) |
| `record-one-sale` after | `fiscalState: pending`, QR names `nif=B00000000` |
| `registros_facturacion` | 1 row, `primer_registro = true`; 1 sale; 1 `pendiente` envío |

Also verified: both failure paths exit non-zero (an operator's `&&` chain depends on it).

**Follow-ups this step raised and deliberately did not take**, all recorded here rather than lost:

1. **`registerSif` should derive the NIF itself, and check ownership itself.** Both invariants above
   are properties of a *SIF registration*, not of provisioning — enforced today in one caller, while
   `registerSif` stays callable with any NIF and any till. The package-boundary objection is already
   dead: `backend.ts` imports `tenants` from `@waitron/db` and reads `tenants.legalName` for
   `SistemaInformatico.NombreRazon`, the sibling field to `NIF` in the same object. Moving both down
   would *delete* this module rather than grow it. Deferred only because it is a signature change
   across ~25 call sites in a package this cycle is not otherwise touching.
2. **`registro_sif` (and `registros_facturacion`) should carry a composite foreign key** on
   (tenant_id, till_id) instead of two independent ones. Needs a `UNIQUE (id, tenant_id)` on `tills`
   first, so it is a migration in `packages/db` *and* one in `packages/fiscal-verifactu`, in that
   order. Schema workstream, not a provisioning script.
3. **The `build` script now repeats the same esbuild flag set and `createRequire` banner three
   times.** Third occurrence is where extraction earns itself; a bump to `--target` is currently a
   three-site edit inside one string with nothing to catch a miss. Left alone here because collapsing
   it touches the two pre-existing invocations and `dist/server.js`'s name is load-bearing in both the
   `bin` field and CI's bundle smoke test.
4. **`record-one-sale.ts` keeps the older convention** — whole body in `scripts/`, therefore
   uncovered. Moving its body into `src/` the way this step did would give it the two refusal paths
   it has never had.

**Record in Task 5:** provisioning a till is a product gap, not just a plan gap. The first customer
till in a real deployment will hit this too, and the eventual provisioning surface must cover SIF
registration — not only tenant, location, till and series. Also record the plan defect this step
found: **Task 2 Step 2's boot command omitted the key ring entirely** and the key was not generated
until Task 2 Step 4, two steps later — the operator would have hit `credentials.key_missing` on an
unmigrated database. Corrected above. That is the *sixth* operational error execution found in a plan
that was reviewed before it was run, and the second of the same shape as finding §4 in the handoff.

- [ ] **Step 5: [HUMAN] Record one real sale on the deli's database**

Small, real, and defensible as a genuine transaction — a single low-value item. It is a real fiscal record from the moment it is chained.

- [ ] **Step 6: [HUMAN] Start the host and let drain submit**

```bash
export DATABASE_URL="$DELI_DATABASE_URL"
export WAITRON_AEAT_ENV=preproduction
export WAITRON_CREDENTIALS_KEY WAITRON_CREDENTIALS_KEY_VERSION
pnpm --filter @waitron/server build
node apps/server/dist/server.js
```

Watch for: `drain.tenant_skipped` disappearing (the certificate now resolves), a submission attempt, and the ack recorded against the `envios` row. Then:

```bash
psql "$DELI_DATABASE_URL" -c "select estado, codigo_error, descripcion_error from envios"
```

**The success criterion is a readable outcome, not the absence of an error.**

---

## Task 5: Write down what actually happened

**Files:**

- Create: `docs/compliance/first-aeat-contact.md`

- [ ] **Step 1: Record it as it happened**

Not a summary written afterwards: the probe's exact response, every AEAT rejection with its code and description, every place the README's grant recipe was wrong, and every place the host's logs did not say what was needed. Include what worked, so the second deli is cheaper.

- [ ] **Step 2: Answer the question this cycle was really asking**

Did #35's and #36's observability make a first AEAT contact readable? State it plainly either way. **If the answer is no, that finding outranks the submission itself** and belongs at the top of the document.

- [ ] **Step 3: Commit**

```bash
git add docs/compliance/first-aeat-contact.md
git commit -s -m "docs(compliance): what the first AEAT contact actually did"
```

---

## Verification summary

| Claim | How it is checked | Where |
| --- | --- | --- |
| The exported certificate works unattended | A parsed `consultar` response from `prewww1.aeat.es` | Task 1 Step 6 |
| The probe can never run in CI or `pnpm test` | Excluded in `vitest.config.ts`; its own config | Task 1 Steps 1–4 |
| Nothing files anything before we intend it to | The probe calls `consultar`, never `submit` | Task 1 Step 3 |
| The deli's rows are real, not test seeds | `bootstrap-tenant.sql` takes every value from the operator | Task 2 |
| The grant recipe actually works | First real use; failures fixed in this cycle | Task 2 Step 4 |
| The certificate is sealed and readable by the host | `waitron-credentials list`, then `drain` stops skipping | Task 3 Step 4, Task 4 Step 6 |
| One sale reaches AEAT with a readable outcome | `envios.estado` + `codigo_error` | Task 4 Step 6 |
| No secret leaked | No `.p12`, passphrase or key in any commit, argument, or transcript | throughout |
