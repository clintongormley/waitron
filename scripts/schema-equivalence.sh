#!/usr/bin/env sh
# Schema-equivalence proof for the migration squash
# (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §2).
#
#   scripts/schema-equivalence.sh <OLD_ROOT> <NEW_ROOT> <OUT_DIR> [--gate-new]
#
# Applies every migration set of OLD_ROOT to one postgres:18-alpine container and every migration
# set of NEW_ROOT to another, as a non-superuser owner role (the shape the provisioner produces),
# dumps both schemas, removes from both exactly the objects the design deletes and the one kind it
# adds, and diffs. Exit 0 and "EQUIVALENT" on an empty normalised diff; exit 1 and the diff
# otherwise. A non-empty diff is a defect in the baseline, never something to normalise away —
# scripts/schema-equivalence.md is how to read one.
#
# --gate-new reads the RAW dumps and refuses the run when the NEW one still CONTAINS an object the
# design deletes (a policy, an RLS switch, current_tenant_id, a helper role, a seam function's
# SECURITY DEFINER), when it is MISSING a seam function's EXECUTE ACL, or when the OLD one carries
# an ENABLE ALWAYS TRIGGER. The normaliser removes all of those from both sides, so without the flag
# a baseline that kept or lost one still diffs clean; the per-module runs pass the flag, the two
# OLD-vs-OLD controls do not.
set -eu

usage() {
  echo "usage: $0 <OLD_ROOT> <NEW_ROOT> <OUT_DIR> [--gate-new]" >&2
  exit 2
}
[ $# -ge 3 ] && [ $# -le 4 ] || usage
GATE_NEW=0
case ${4:-} in
  "") ;;
  --gate-new) GATE_NEW=1 ;;
  *) usage ;;
esac

# docker refuses a relative bind-mount source, and both roots are mounted read-only at /repo.
OLD_ROOT=$(cd "$1" && pwd)
NEW_ROOT=$(cd "$2" && pwd)
mkdir -p "$3"
OUT=$(cd "$3" && pwd)

# A run that aborts part-way — a migration that will not apply is the common one — must not leave a
# postgres process and its volume behind: interrupted container suites are how this repo starves
# PGlite hooks (CLAUDE.md §4). The label is `pnpm reap`'s, as the backstop.
cleanup() { docker rm -fv waitron-schemaeq-old waitron-schemaeq-new >/dev/null 2>&1 || true; }
trap cleanup EXIT

order() { # migration files of a checkout, in manifest + journal order
  python3 - "$1" <<'PY'
import json, os, sys
repo = sys.argv[1]
manifest = json.load(open(os.path.join(repo, "packages/migrations/migrations.manifest.json")))
selection = os.environ.get("SCHEMAEQ_MODULES")
modules = None if selection is None else set(selection.split(","))
if modules is not None:
    unknown = modules - {s["name"] for s in manifest}
    if unknown:
        sys.exit("unknown SCHEMAEQ_MODULES: " + ", ".join(sorted(unknown)))
for s in manifest:
    if modules is not None and s["name"] not in modules:
        continue
    d = os.path.normpath(os.path.join("packages/migrations", s["from"]))
    for e in json.load(open(os.path.join(repo, d, "meta/_journal.json")))["entries"]:
        print(f"{d}/{e['tag']}.sql")
PY
}

run() { # run <old|new> <root>: fresh container, migrate as waitron_migrator, dump schema and roles
  name=$1
  root=$2
  container="waitron-schemaeq-$name"
  docker rm -fv "$container" >/dev/null 2>&1 || true
  docker run -d --name "$container" --label com.waitron.reapable=true -e POSTGRES_PASSWORD=pg \
    -v "$root":/repo:ro postgres:18-alpine >/dev/null
  # -h 127.0.0.1, not the default unix socket: initdb's bootstrap server listens on the socket
  # only, so a socket probe reports ready before the real server has started.
  waited=0
  until docker exec "$container" pg_isready -U postgres -q -h 127.0.0.1; do
    waited=$((waited + 1))
    [ "$waited" -lt 120 ] || {
      echo "$container never accepted connections" >&2
      exit 1
    }
    sleep 1
  done
  docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -q \
    -c "CREATE ROLE waitron_migrator LOGIN CREATEROLE PASSWORD 'mig'" \
    -c "CREATE DATABASE waitron OWNER waitron_migrator" </dev/null
  # The file list goes through a FILE, not a pipe: `sh` has no pipefail, so a failing `order` on the
  # left of a pipe cannot abort the run and the loop's `exit 1` only leaves the subshell. Measured
  # under /bin/sh — `set -eu; { echo a; echo b; exit 3; } | while read -r f; do echo "applied $f";
  # done; echo CONTINUED` prints both files, then CONTINUED, rc 0; the same block redirected to a
  # file exits 3 and never reaches the next command. The list also stays in OUT as a receipt of what
  # was applied.
  order "$root" >"$OUT/$name.files"
  # </dev/null on every docker exec: without it the exec eats this loop's stdin and only the first
  # file is applied (measured 2026-09-05).
  while read -r f; do
    docker exec "$container" psql -U waitron_migrator -d waitron -v ON_ERROR_STOP=1 -q -1 \
      -f "/repo/$f" </dev/null || {
      echo "FAILED applying $f on $container" >&2
      exit 1
    }
  done <"$OUT/$name.files"
  docker exec "$container" pg_dump -U postgres -d waitron --schema-only --no-owner \
    </dev/null >"$OUT/$name.sql"
  docker exec "$container" psql -U postgres -d waitron -Atc \
    "select rolname from pg_roles where rolname not like 'pg_%' and rolname not in ('postgres','waitron_migrator') order by 1" \
    </dev/null >"$OUT/$name.roles"
  docker rm -fv "$container" >/dev/null
}

run old "$OLD_ROOT"
run new "$NEW_ROOT"

python3 - "$OUT" "$GATE_NEW" <<'PY'
import re, sys

out, gate_new = sys.argv[1], sys.argv[2] == "1"

# Table grants from these two roles become app_user grants before deleted-role filtering.
# Other references to any helper role remain on the deletion list.
FOLD = {"sync_tailer": "app_user", "sync_retention": "app_user"}
DELETED_ROLES = [
    "tenant_provisioner",
    "credentials_enumerator",
    "envios_drainer",
    "payments_webhook_resolver",
    "sales_coverage_checker",
    "sync_tailer",
    "sync_retention",
]

# Whole statements the design removes (the first four) or adds (the last). The SAME list is applied
# to BOTH dumps, because that is the only normalisation under which OLD-vs-OLD is equal — the
# control that proves this script measures something. On a correct baseline it is also identical to
# normalising one side: the NEW dump contains none of the first four and the OLD dump none of the
# last, which is what the residue table below reports. Read that table, not just the verdict.
DROP = [
    ("CREATE POLICY", r"^CREATE POLICY "),
    ("ROW LEVEL SECURITY", r"ROW LEVEL SECURITY;"),
    ("current_tenant_id", r"\bFUNCTION public\.current_tenant_id\b"),
    ("statements naming a deleted role", r"\b(?:" + "|".join(DELETED_ROLES) + r")\b"),
    ("ENABLE ALWAYS TRIGGER", r"ENABLE ALWAYS TRIGGER"),
]

# The five seam functions lose SECURITY DEFINER and keep everything else, so the CLAUSE is stripped
# and the statement kept: the bodies stay in the comparison, which is where a mis-copied baseline
# would show. sale_settlements_check_coverage is invoker-rights already; it is here so the
# existence check below covers all five the spec names.
SEAM = [
    "credential_tenants",
    "envios_tenants_with_work",
    "resolve_payment_tenant",
    "sales_assert_tenders_cover",
    "sale_settlements_check_coverage",
]
SEAM_RE = re.compile(r"CREATE FUNCTION public\.(" + "|".join(SEAM) + r")\(")
DEFINER = "SECURITY DEFINER clause"

# The ONE strip beyond the delete/add lists above, and the reason is in schema-equivalence.md: the
# old chain's `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO app_user` on three of these
# functions never took effect (each ran after `ALTER FUNCTION … OWNER TO <helper role>`, so the
# migrator no longer owned the function), while the same statements in a baseline DO take effect.
# The dumps therefore differ by exactly these ACLs on a CORRECT baseline. --gate-new is what checks
# the NEW side kept them.
SEAM_ACL_RE = re.compile(
    r"^(?:GRANT|REVOKE)\b.*\bON FUNCTION public\.(?:" + "|".join(SEAM) + r")\(", re.M
)
SEAM_ACL = "seam function ACL (both sides)"

# Only these three carry the REVOKE/GRANT pair in the old chain — packages/credentials/drizzle/
# 0002_credentials_tenant_seam.sql:74-75, packages/fiscal-verifactu/drizzle/
# 0004_envios_drainer_seam.sql:111-112, packages/payments/drizzle/
# 0008_payments_webhook_resolver.sql:68-69. sales_assert_tenders_cover has an OWNER TO and no grant
# (packages/db/drizzle/0005_sales.sql:279); sale_settlements_check_coverage has neither. A baseline
# carrying the old SQL verbatim (spec §2) therefore grants on three, not five.
SEAM_GRANTED = ["credential_tenants", "envios_tenants_with_work", "resolve_payment_tenant"]

DOLLAR = re.compile(r"\$[A-Za-z_0-9]*\$")


def split_statements(text):
    """Split pg_dump output at top-level `;`, respecting '…', $tag$…$tag$ and -- comments.

    A plain `re.split` on `;\\n` cuts current_tenant_id and sales_assert_tenders_cover apart at the
    semicolons inside their plpgsql bodies, which leaves orphan fragments behind when the statement
    they belong to is dropped.
    """
    stmts, start, i, n = [], 0, 0, len(text)
    while i < n:
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
        elif text[i] == "'":
            i += 1
            while i < n:
                if text[i] == "'":
                    if text.startswith("''", i):
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
        elif text[i] == "$" and DOLLAR.match(text, i):
            tag = DOLLAR.match(text, i).group(0)
            j = text.find(tag, i + len(tag))
            i = n if j < 0 else j + len(tag)
        elif text[i] == ";":
            stmts.append(text[start : i + 1])
            start = i + 1
            i += 1
        else:
            i += 1
    if text[start:].strip():
        stmts.append(text[start:])
    return stmts


TABLE_RE = re.compile(r"^(CREATE TABLE [^\n]*\(\n)(.*?)(\n\);)", re.M | re.S)
COLUMNS = "CREATE TABLE columns sorted"


def sort_table_columns(stmt, counts):
    """Sort the column definitions inside a CREATE TABLE block. The ONE representational
    normalisation: the old chain accretes columns with ALTER TABLE and a baseline declares them in
    schema-file order, so pg_dump's attnum order differs while the table does not. pg_dump's inline
    CHECK constraints follow the columns in NAME order, not creation order — measured on
    PostgreSQL 18.6, a table created with `CONSTRAINT z_chk` inline and `a_chk` added afterwards
    dumps a_chk first — so they are already canonical and the trailing run is left alone.
    """

    def one(m):
        head, body, tail = m.group(1), m.group(2), m.group(3)
        entries = [line.rstrip().rstrip(",") for line in body.split("\n")]
        cut = next(
            (i for i, e in enumerate(entries) if e.lstrip().startswith("CONSTRAINT ")), len(entries)
        )
        if cut < 2:
            return m.group(0)
        entries = sorted(entries[:cut]) + entries[cut:]
        counts[COLUMNS] += 1
        return head + ",\n".join(entries) + tail

    return TABLE_RE.sub(one, stmt)


# pg_dump's table privilege order, as emitted in the raw dumps (SELECT,INSERT,DELETE,UPDATE).
TABLE_VERBS = ["SELECT", "INSERT", "DELETE", "UPDATE"]
FOLD_ACL_RE = re.compile(
    r"^((?:GRANT|REVOKE) [^;\n]+ ON TABLE public\.[^;\n]+ (?:TO|FROM) )"
    r"(" + "|".join(FOLD) + r");$", re.M
)
APP_TABLE_GRANT_RE = re.compile(
    r"^GRANT ([A-Z,]+) ON TABLE (public\.[^;\n]+) TO app_user;$", re.M
)


def fold_table_grants(statements):
    """Fold table ACL grantees and union table privileges; keep column ACLs separate."""
    folded, grants = [], {}
    for stmt in statements:
        folded_acl = FOLD_ACL_RE.search(stmt)
        if folded_acl and folded_acl[1].startswith("REVOKE "):
            raise ValueError(f"unsupported folded REVOKE: {folded_acl[0]}")
        stmt = FOLD_ACL_RE.sub(lambda m: m[1] + FOLD[m[2]] + ";", stmt)
        match = APP_TABLE_GRANT_RE.search(stmt)
        if match:
            verbs, table = match.groups()
            if table in grants:
                grants[table].update(verbs.split(","))
                continue
            grants[table] = set(verbs.split(","))
        folded.append(stmt)
    for stmt in folded:
        match = APP_TABLE_GRANT_RE.search(stmt)
        if match:
            table = match[2]
            verbs = grants[table]
            # ALL stays ALL; unknown privileges fail instead of silently disappearing.
            if verbs - set(TABLE_VERBS) - {"ALL"}:
                raise ValueError(f"unknown table privileges on {table}: {verbs}")
            union = "ALL" if "ALL" in verbs else ",".join(v for v in TABLE_VERBS if v in verbs)
            stmt = APP_TABLE_GRANT_RE.sub(f"GRANT {union} ON TABLE {table} TO app_user;", stmt)
        yield stmt


def normalise(text, counts):
    kept = []
    for stmt in fold_table_grants(split_statements(text)):
        hit = next((label for label, pat in DROP if re.search(pat, stmt, re.M | re.S)), None)
        if hit is not None:
            counts[hit] += 1
            continue
        if SEAM_ACL_RE.search(stmt):
            counts[SEAM_ACL] += 1
            continue
        if SEAM_RE.search(stmt):
            stmt, stripped = re.subn(r"\s+SECURITY DEFINER\b", "", stmt)
            counts[DEFINER] += stripped
        kept.append(sort_table_columns(stmt, counts))
    text = "".join(kept)
    text = re.sub(r"^--.*$", "", text, flags=re.M)  # pg_dump's per-object headers
    text = re.sub(r"^\\(un)?restrict\b.*$", "", text, flags=re.M)  # random token, new every dump
    text = re.sub(r"^(SET|SELECT pg_catalog\.set_config)\b.*$", "", text, flags=re.M)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip() + "\n"


residue, raws = {}, {}
for side in ("old", "new"):
    raws[side] = open(f"{out}/{side}.sql", encoding="utf-8").read()
    counts = dict.fromkeys([label for label, _ in DROP] + [SEAM_ACL, DEFINER, COLUMNS], 0)
    normalised = normalise(raws[side], counts)
    open(f"{out}/{side}.normalised.sql", "w", encoding="utf-8").write(normalised)
    residue[side] = counts

width = max(len(label) for label in residue["old"])
lines = [
    "normalisation counts (statements dropped; last three rows: seam ACL statements dropped from"
    " both sides, SECURITY DEFINER clauses stripped, CREATE TABLEs sorted)",
    f"  {'':{width}}  OLD  NEW",
]
for label in residue["old"]:
    lines.append(f"  {label:{width}}  {residue['old'][label]:>3}  {residue['new'][label]:>3}")
report = "\n".join(lines) + "\n"
open(f"{out}/normalisation.txt", "w", encoding="utf-8").write(report)
sys.stdout.write(report)

old_seams = {fn for fn in SEAM if f"CREATE FUNCTION public.{fn}(" in raws["old"]}
missing = [fn for fn in SEAM if fn in old_seams and f"CREATE FUNCTION public.{fn}(" not in raws["new"]]
if missing:
    sys.exit("seam functions missing from NEW: " + ", ".join(missing))

# --gate-new: read the RAW new dump, before normalisation, for the objects the design deletes. The
# normaliser removes these from both sides, so without this a baseline that kept one diffs clean.
if gate_new:
    GATED = [
        ("CREATE POLICY", r"^CREATE POLICY "),
        ("ROW LEVEL SECURITY", r"ROW LEVEL SECURITY"),
        ("current_tenant_id", r"\bcurrent_tenant_id\b"),
    ]
    GATED += [(f"role {r}", rf"\b{r}\b") for r in DELETED_ROLES]
    problems = []
    for label, pat in GATED:
        hits = [
            ln for ln in raws["new"].splitlines() if re.search(pat, ln) and not ln.startswith("--")
        ]
        if hits:
            problems.append(
                f"  still present — {label}: {len(hits)} line(s), first: {hits[0].strip()[:84]}"
            )
    # A seam function that kept SECURITY DEFINER. Statement-level, because the clause and the name
    # are on different lines — and gated at all because the normaliser strips the clause from both
    # sides, so without this check such a baseline prints EQUIVALENT.
    for stmt in split_statements(raws["new"]):
        m = SEAM_RE.search(stmt)
        if m and m.group(1) in old_seams and re.search(r"\bSECURITY DEFINER\b", stmt):
            problems.append(f"  still present — SECURITY DEFINER on public.{m.group(1)}()")
    # The residue table's other reader rule, made a gate: only the NEW side may add these.
    if residue["old"]["ENABLE ALWAYS TRIGGER"]:
        problems.append(
            f"  unexpected — the OLD dump carries {residue['old']['ENABLE ALWAYS TRIGGER']}"
            " ENABLE ALWAYS TRIGGER statement(s)"
        )
    # The seam ACLs the normaliser strips from both sides have to be checked here instead: in the
    # baselines these statements finally take effect, and nothing else would notice if they were
    # dropped on the way. Both halves of the old chain's pair are required, because a baseline that
    # kept the GRANT and lost the REVOKE would leave PUBLIC's default EXECUTE in place — a widened
    # privilege the diff cannot see. pg_dump emits each half only when it took effect (measured:
    # a function the migrator still owns dumps `REVOKE ALL … FROM PUBLIC;` + `GRANT ALL … TO
    # app_user;`, one handed to a helper role first dumps neither). Three functions, not five —
    # see SEAM_GRANTED.
    for fn in SEAM_GRANTED:
        if fn not in old_seams:
            continue
        for verb, tail in (("GRANT", r"TO app_user"), ("REVOKE", r"FROM PUBLIC")):
            pat = rf"^{verb}\b.*\bON FUNCTION public\.{fn}\(.*\b{tail}\b"
            if not re.search(pat, raws["new"], re.M):
                problems.append(f"  missing — {verb} … ON FUNCTION public.{fn}(…) {tail}")
    if problems:
        sys.exit("--gate-new refused the NEW dump:\n" + "\n".join(problems))
PY

echo "roles OLD: $(tr '\n' ' ' <"$OUT/old.roles")"
echo "roles NEW: $(tr '\n' ' ' <"$OUT/new.roles")"

if diff -u "$OUT/old.normalised.sql" "$OUT/new.normalised.sql" >"$OUT/schema.diff"; then
  echo "EQUIVALENT ($(wc -l <"$OUT/old.normalised.sql" | tr -d ' ') normalised lines each)"
else
  echo "NOT EQUIVALENT — see $OUT/schema.diff"
  head -60 "$OUT/schema.diff"
  exit 1
fi
