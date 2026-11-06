#!/bin/bash
# A1324 test: does a customer-supplied key on Litestream 0.5.17 keep a bucket login alone from
# reading the copy? Uses made-up data only.
#   Amazon:  AWS_SHARED_CREDENTIALS_FILE=... AWS_CONFIG_FILE=... AWS_PROFILE=waitron-rehearsal AWS_REGION=eu-north-1 ./run.sh
#   Local:   ENDPOINT=http://127.0.0.1:PORT AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 ./run.sh
# The failing case: step 5 prints READABLE, meaning the bucket login alone read the copy.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); LS=$HERE/.bin/litestream
W=$(mktemp -d "$HERE/run.XXXXXX"); B=waitron-rehearsal-sse-$(openssl rand -hex 5); DB=$W/venue.db
EP=(); [ -n "${ENDPOINT:-}" ] && EP=(--endpoint-url "$ENDPOINT")
A=(aws ${EP[@]+"${EP[@]}"} s3api); say(){ printf '\n== %s\n' "$*"; }
openssl rand -out "$W/key.bin" 32; base64 < "$W/key.bin" | tr -d '\n' > "$W/key.b64"
openssl rand -out "$W/wrong.bin" 32
MD5=$(openssl md5 -binary "$W/key.bin" | base64)
cleanup(){ say "clean up"; kill "${PID:-0}" 2>/dev/null; for k in $("${A[@]}" list-objects-v2 --bucket "$B" --query 'Contents[].Key' --output text 2>/dev/null | sed 's/None//'); do "${A[@]}" delete-object --bucket "$B" --key "$k" >/dev/null; done; "${A[@]}" delete-bucket --bucket "$B" && echo "bucket removed"; rm -f "$W/key.bin" "$W/key.b64" "$W/wrong.bin"; }
trap cleanup EXIT
say "1 make the bucket $B"
if [ "${AWS_REGION}" = us-east-1 ]; then "${A[@]}" create-bucket --bucket "$B" >/dev/null || exit 1
else "${A[@]}" create-bucket --bucket "$B" --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null || exit 1; fi
say "2 control: upload with a customer key on a fresh bucket (Amazon should refuse: blocked by default)"
echo probe > "$W/probe"
"${A[@]}" put-object --bucket "$B" --key probe --body "$W/probe" --sse-customer-algorithm AES256 --sse-customer-key "fileb://$W/key.bin" >/dev/null 2>"$W/e"; echo "exit $?: $(tail -1 "$W/e" | cut -c1-140)"
say "3 unblock customer keys on this bucket"
"${A[@]}" get-bucket-encryption --bucket "$B" --output json 2>&1 | tr -d ' \n' | cut -c1-260; echo
"${A[@]}" put-bucket-encryption --bucket "$B" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BlockedEncryptionTypes":{"EncryptionType":["NONE"]}}]}' 2>&1 | tail -1 | cut -c1-160; echo "exit ${PIPESTATUS[0]}"
"${A[@]}" delete-object --bucket "$B" --key probe >/dev/null 2>&1
say "4 replicate made-up rows for 75 seconds, across Litestream's 30-second compaction"
node -e "const{DatabaseSync:D}=require('node:sqlite');const d=new D('$DB');d.exec('pragma journal_mode=wal;create table t(id integer primary key,v text);');d.close()"
cat > "$W/ls.yml" <<Y
dbs:
  - path: $DB
    replica:
      type: s3
      bucket: $B
      path: venue
      region: $AWS_REGION
      ${ENDPOINT:+endpoint: $ENDPOINT}
      ${ENDPOINT:+force-path-style: true}
      sse-customer-algorithm: AES256
      sse-customer-key-path: $W/key.b64
Y
"$LS" replicate -config "$W/ls.yml" >"$W/ls.log" 2>&1 & PID=$!
for i in $(seq 1 15); do node -e "const{DatabaseSync:D}=require('node:sqlite');const d=new D('$DB');for(let i=0;i<20;i++)d.prepare('insert into t(v) values(?)').run('made-up-row-marker-$i');d.close()"; sleep 5; done
sleep 5; kill $PID; wait $PID 2>/dev/null; PID=
echo "litestream errors:"; /usr/bin/grep -i -c -E '"?level"?=?:?"?(error|warn)|ERROR|WARN' "$W/ls.log"; /usr/bin/grep -i -E 'ERROR|WARN' "$W/ls.log" | head -4 | cut -c1-200
ROWS=$(node -e "const{DatabaseSync:D}=require('node:sqlite');console.log(new D('$DB').prepare('select count(*) c from t').get().c)"); echo "rows on the box: $ROWS"
K=$("${A[@]}" list-objects-v2 --bucket "$B" --prefix venue --query 'Contents[?Size>`0`].Key' --output text | tr '\t' '\n' | grep -v '^None' | /usr/bin/grep -E 'ltx' | tail -1); N=$("${A[@]}" list-objects-v2 --bucket "$B" --query 'length(Contents)' --output text); echo "objects: $N, sample: $K"
say "5 THE TEST: read an object with the bucket login alone"
if "${A[@]}" get-object --bucket "$B" --key "$K" "$W/plain" >/dev/null 2>"$W/e"; then echo "READABLE: $(wc -c <"$W/plain") bytes, marker found: $(/usr/bin/grep -a -c made-up-row-marker "$W/plain")"; else echo "refused: $(tail -1 "$W/e" | cut -c1-170)"; fi
say "6 read it with a wrong key, then the right key"
"${A[@]}" get-object --bucket "$B" --key "$K" --sse-customer-algorithm AES256 --sse-customer-key "fileb://$W/wrong.bin" "$W/w" >/dev/null 2>"$W/e"; echo "wrong key exit $?: $(tail -1 "$W/e" | cut -c1-140)"
"${A[@]}" get-object --bucket "$B" --key "$K" --sse-customer-algorithm AES256 --sse-customer-key "fileb://$W/key.bin" "$W/r" >/dev/null 2>"$W/e"; echo "right key exit $?"
say "7 restore with the key, then without it"
"$LS" restore -config "$W/ls.yml" -o "$W/restored.db" "$DB" >"$W/r.log" 2>&1; echo "with key exit $?"; [ -f "$W/restored.db" ] && node -e "const{DatabaseSync:D}=require('node:sqlite');console.log('rows restored:',new D('$W/restored.db').prepare('select count(*) c from t').get().c,'of $ROWS')"
sed '/sse-customer/d' "$W/ls.yml" > "$W/nokey.yml"
"$LS" restore -config "$W/nokey.yml" -o "$W/nokey.db" "$DB" >"$W/n.log" 2>&1; echo "without key exit $?: $(tail -1 "$W/n.log" | cut -c1-170)"
