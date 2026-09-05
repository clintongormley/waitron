#!/usr/bin/env sh
# Schema-equivalence proof for the migration squash
# (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §2).
#
#   scripts/schema-equivalence.sh <OLD_ROOT> <NEW_ROOT> <OUT_DIR>
#
# Applies every migration set of OLD_ROOT to one postgres:18-alpine container and every migration
# set of NEW_ROOT to another, as a non-superuser owner role (the shape the provisioner produces),
# dumps both schemas, removes from both exactly the objects the design deletes and the one kind it
# adds, and diffs. Exit 0 and "EQUIVALENT" on an empty normalised diff; exit 1 and the diff
# otherwise. A non-empty diff is a defect in the baseline, never something to normalise away —
# scripts/schema-equivalence.md is how to read one.
set -eu

[ $# -eq 3 ] || {
  echo "usage: $0 <OLD_ROOT> <NEW_ROOT> <OUT_DIR>" >&2
  exit 2
}

# docker refuses a relative bind-mount source, and both roots are mounted read-only at /repo.
OLD_ROOT=$(cd "$1" && pwd)
NEW_ROOT=$(cd "$2" && pwd)
mkdir -p "$3"
OUT=$(cd "$3" && pwd)

# A run that aborts part-way — a migration that will not apply is the common one — must not leave a
# postgres process and its volume behind: interrupted container suites are how this repo starves
# PGlite hooks (CLAUDE.md §4). The label is `pnpm reap`'s, as the backstop.
cleanup() { docker rm -f waitron-schemaeq-old waitron-schemaeq-new >/dev/null 2>&1 || true; }
trap cleanup EXIT

order() { # migration files of a checkout, in manifest + journal order
  python3 - "$1" <<'PY'
import json, os, sys
repo = sys.argv[1]
for s in json.load(open(os.path.join(repo, "packages/migrations/migrations.manifest.json"))):
    d = os.path.normpath(os.path.join("packages/migrations", s["from"]))
    for e in json.load(open(os.path.join(repo, d, "meta/_journal.json")))["entries"]:
        print(f"{d}/{e['tag']}.sql")
PY
}

run() { # run <old|new> <root>: fresh container, migrate as waitron_migrator, dump schema and roles
  name=$1
  root=$2
  container="waitron-schemaeq-$name"
  docker rm -f "$container" >/dev/null 2>&1 || true
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
  # </dev/null on every docker exec: without it the exec eats this loop's stdin and only the first
  # file is applied (measured 2026-09-05).
  order "$root" | while read -r f; do
    docker exec "$container" psql -U waitron_migrator -d waitron -v ON_ERROR_STOP=1 -q -1 \
      -f "/repo/$f" </dev/null || {
      echo "FAILED applying $f on $container" >&2
      exit 1
    }
  done
  docker exec "$container" pg_dump -U postgres -d waitron --schema-only --no-owner \
    </dev/null >"$OUT/$name.sql"
  docker exec "$container" psql -U postgres -d waitron -Atc \
    "select rolname from pg_roles where rolname not like 'pg_%' and rolname not in ('postgres','waitron_migrator') order by 1" \
    </dev/null >"$OUT/$name.roles"
  docker rm -f "$container" >/dev/null
}

run old "$OLD_ROOT"
run new "$NEW_ROOT"

python3 - "$OUT" <<'PY'
import re, sys

out = sys.argv[1]

# The seven helper roles the design deletes (spec §1). sync_tailer and sync_retention fold into
# app_user in step 1 — that their grants landed on app_user is checked by hand on the NEW container
# (Task 6, `\dp sync_log`) — and the roles themselves go in step 4.
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
SEAM_RE = re.compile(r"CREATE FUNCTION public\.(?:" + "|".join(SEAM) + r")\(")
DEFINER = "SECURITY DEFINER clause"

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


def normalise(text, counts):
    kept = []
    for stmt in split_statements(text):
        hit = next((label for label, pat in DROP if re.search(pat, stmt, re.M | re.S)), None)
        if hit is not None:
            counts[hit] += 1
            continue
        if SEAM_RE.search(stmt):
            stmt, stripped = re.subn(r"\s+SECURITY DEFINER\b", "", stmt)
            counts[DEFINER] += stripped
        kept.append(stmt)
    text = "".join(kept)
    text = re.sub(r"^--.*$", "", text, flags=re.M)  # pg_dump's per-object headers
    text = re.sub(r"^\\(un)?restrict\b.*$", "", text, flags=re.M)  # random token, new every dump
    text = re.sub(r"^(SET|SELECT pg_catalog\.set_config)\b.*$", "", text, flags=re.M)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip() + "\n"


residue = {}
for side in ("old", "new"):
    raw = open(f"{out}/{side}.sql", encoding="utf-8").read()
    counts = dict.fromkeys([label for label, _ in DROP] + [DEFINER], 0)
    open(f"{out}/{side}.normalised.sql", "w", encoding="utf-8").write(normalise(raw, counts))
    residue[side] = counts
    if side == "new":
        missing = [fn for fn in SEAM if f"CREATE FUNCTION public.{fn}(" not in raw]
        if missing:
            sys.exit("seam functions missing from NEW: " + ", ".join(missing))

width = max(len(label) for label in residue["old"])
lines = ["normalised away (statements, except the last row: clauses)",
         f"  {'':{width}}  OLD  NEW"]
for label in residue["old"]:
    lines.append(f"  {label:{width}}  {residue['old'][label]:>3}  {residue['new'][label]:>3}")
report = "\n".join(lines) + "\n"
open(f"{out}/normalisation.txt", "w", encoding="utf-8").write(report)
sys.stdout.write(report)
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
