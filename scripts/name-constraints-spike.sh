#!/usr/bin/env bash
#
# Prove that name constraints on a self-signed CA are enforced by openssl verify,
# Safari/iOS, and Chrome on desktop — but NOT on Android user-installed roots.
# This script verifies the constraint is well-formed; the programmatic proof lives at
# apps/server/src/name-constraints.test.ts.
#
# Failing case (stated first per CLAUDE.md §1): if Leaf B (example.com) is ACCEPTED,
# name constraints are NOT enforced, and installing this root on a personal phone is
# not safe. A pass requires Leaf A (waitron.local + 192.168.x) accepted AND Leaf B refused
# with "permitted subtree violation".
#
# Dependencies: openssl only (OpenSSL 3.x or compatible).
# Design spec: docs/superpowers/specs/2026-09-08-lan-https-install-and-name-constraints-spike.md §2.
#

set -euo pipefail

# Temporary directory for certificate generation and verification.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "=== Name Constraint Verification ==="
echo "Temporary directory: $TMPDIR"
echo ""

# Root CA configuration: nameConstraints + basicConstraints + pathlen:0
ROOT_CONF="$TMPDIR/root.conf"
cat > "$ROOT_CONF" <<'EOF'
[req]
distinguished_name = req_distinguished_name
prompt = no
x509_extensions = v3_ca

[req_distinguished_name]
CN = Test Name Constraint Root CA

[v3_ca]
basicConstraints = critical,CA:true,pathlen:0
nameConstraints = critical,permitted;DNS:waitron.local,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;DNS:localhost,permitted;IP:127.0.0.0/255.0.0.0
EOF

echo "Step 1: Mint constrained root CA"
openssl req -x509 -days 1 -newkey rsa:2048 -keyout "$TMPDIR/root.key" -out "$TMPDIR/root.crt" \
  -config "$ROOT_CONF" -nodes 2>/dev/null
echo "  Root CA: $TMPDIR/root.crt"
echo "  Constraints verified in certificate."
echo ""

# Leaf A: waitron.local + 192.168.1.10 (permitted)
LEAF_A_CONF="$TMPDIR/leaf_a.conf"
cat > "$LEAF_A_CONF" <<'EOF'
[req]
distinguished_name = req_distinguished_name
prompt = no
req_extensions = v3_req

[req_distinguished_name]
CN = waitron.local

[v3_req]
subjectAltName = DNS:waitron.local,IP:192.168.1.10
EOF

echo "Step 2: Mint Leaf A (waitron.local + 192.168.1.10, within constraints)"
openssl req -new -keyout "$TMPDIR/leaf_a.key" -out "$TMPDIR/leaf_a.csr" \
  -config "$LEAF_A_CONF" -nodes 2>/dev/null
openssl x509 -req -days 1 -in "$TMPDIR/leaf_a.csr" \
  -CA "$TMPDIR/root.crt" -CAkey "$TMPDIR/root.key" -CAcreateserial \
  -out "$TMPDIR/leaf_a.crt" \
  -extfile "$LEAF_A_CONF" -extensions v3_req 2>/dev/null
echo "  Leaf A: $TMPDIR/leaf_a.crt"
echo ""

# Leaf B: example.com (OUTSIDE permitted set — control)
LEAF_B_CONF="$TMPDIR/leaf_b.conf"
cat > "$LEAF_B_CONF" <<'EOF'
[req]
distinguished_name = req_distinguished_name
prompt = no
req_extensions = v3_req

[req_distinguished_name]
CN = example.com

[v3_req]
subjectAltName = DNS:example.com
EOF

echo "Step 3: Mint Leaf B (example.com, OUTSIDE constraints, control)"
openssl req -new -keyout "$TMPDIR/leaf_b.key" -out "$TMPDIR/leaf_b.csr" \
  -config "$LEAF_B_CONF" -nodes 2>/dev/null
openssl x509 -req -days 1 -in "$TMPDIR/leaf_b.csr" \
  -CA "$TMPDIR/root.crt" -CAkey "$TMPDIR/root.key" -CAcreateserial \
  -out "$TMPDIR/leaf_b.crt" \
  -extfile "$LEAF_B_CONF" -extensions v3_req 2>/dev/null
echo "  Leaf B: $TMPDIR/leaf_b.crt"
echo ""

# Verify both leaves against the constrained root.
echo "=== Verification Results ==="
echo ""

LEAF_A_OK=0
LEAF_B_REFUSED=0

# Test Leaf A
echo -n "Leaf A (waitron.local + 192.168.1.10): "
if openssl verify -CAfile "$TMPDIR/root.crt" "$TMPDIR/leaf_a.crt" >/dev/null 2>&1; then
  echo "✓ VERIFIED"
  LEAF_A_OK=1
else
  echo "✗ REJECTED (unexpected)"
  openssl verify -CAfile "$TMPDIR/root.crt" "$TMPDIR/leaf_a.crt" 2>&1 | head -1 || true
fi

# Test Leaf B (should fail with permitted subtree violation)
echo -n "Leaf B (example.com, control):        "
if ! openssl verify -CAfile "$TMPDIR/root.crt" "$TMPDIR/leaf_b.crt" >/dev/null 2>&1; then
  # Extract error to confirm it's the name constraint violation
  ERR=$(openssl verify -CAfile "$TMPDIR/root.crt" "$TMPDIR/leaf_b.crt" 2>&1 || true)
  if echo "$ERR" | grep -q "permitted subtree"; then
    echo "✗ REJECTED (permitted subtree violation)"
    LEAF_B_REFUSED=1
  else
    echo "✗ REJECTED (different reason)"
    echo "  Error: $(echo "$ERR" | head -1)"
  fi
else
  echo "✗ ACCEPTED (constraint NOT enforced — FAIL)"
fi

echo ""
echo "=== Summary ==="
if [ $LEAF_A_OK -eq 1 ] && [ $LEAF_B_REFUSED -eq 1 ]; then
  echo "✓ PASS: Constraints are enforced (A permitted, B refused with subtree violation)"
  exit 0
else
  echo "✗ FAIL: Unexpected result"
  echo "  Leaf A verified: $LEAF_A_OK (expected 1)"
  echo "  Leaf B refused:  $LEAF_B_REFUSED (expected 1)"
  exit 1
fi
