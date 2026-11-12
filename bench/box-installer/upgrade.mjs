import { Buffer } from "node:buffer";

const node = "/opt/waitron-host/node-v26.7.0/bin/node";
const cli = `${node} /opt/waitron-host/box/upgrades/cli.mjs`;
const shell = "bash /opt/waitron-host/waitron.sh";
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const run = (text) => `${node} --input-type=module -e ${quote(text)}`;
const fingerprint = run(`
import {DatabaseSync} from 'node:sqlite'; import {createHash} from 'node:crypto';
const db=new DatabaseSync('/var/lib/docker/volumes/waitron_state/_data/venue/venue.db',{readOnly:true});
try { console.log(JSON.stringify(Object.fromEntries(['sales','sale_lines','registros_facturacion','working_orders','working_order_lines'].map(table=>{
 const rows=db.prepare('select * from '+JSON.stringify(table)+' order by rowid').all();
 return [table,{count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}];
})))); } finally {db.close()}
`);
const start = `
for attempt in $(seq 1 180); do
 if [ "$(timedatectl show -p NTPSynchronized --value)" = yes ]; then break; fi
 sleep 1
done
test "$(timedatectl show -p NTPSynchronized --value)" = yes
/usr/local/sbin/waitron-dev-start
${fingerprint} >/opt/waitron/before.json
jq -e '.sales.count==1 and .registros_facturacion.count==1 and .working_orders.count==1' /opt/waitron/before.json
`;
const compare = `${fingerprint} >/opt/waitron/after.json
cmp /opt/waitron/before.json /opt/waitron/after.json
`;
const apply = `flock -n /opt/waitron.upgrade.lock ${cli} apply /opt/waitron /bin/bash /opt/waitron-host/prepare-fixture.sh`;
const shim = String.raw`#!/bin/bash
set -e
/bin/cp "$@"
for last in "$@"; do :; done
if [ "$A950_PROBE" != restore ] && [[ "$last" != */copies/0 ]]; then exit 0; fi
case "$*" in
 *copies/0*)
  if [ "$A950_PROBE" = block ]; then
    /opt/waitron-host/node-v26.7.0/bin/node -e 'require("node:net").createServer().listen(443,"0.0.0.0",()=>require("node:fs").writeFileSync("/run/a950-port-ready","yes"))' >/run/a950-port.log 2>&1 </dev/null &
    echo $! >/run/a950-port.pid
    while [ ! -f /run/a950-port-ready ]; do sleep 0.1; done
  else
    if [ "$A950_PROBE" = restore ]; then touch /var/lib/docker/volumes/waitron_state/_data/partial-restore; fi
    echo A950_CUT
    sleep infinity
  fi ;;
esac
`;
const failed = `
rm -f /run/a950-port-ready
A950_PROBE=block PATH=/opt/waitron-host/probe-bin:$PATH ${apply} >/opt/waitron/held.json
jq -e '.phase=="awaiting-choice" and .copied==true' /opt/waitron/held.json
test -z "$(docker ps -q --filter label=com.docker.compose.project=waitron)"
kill "$(cat /run/a950-port.pid)"
`;

export function upgradeStage() {
  const prepare = run(
    `import fs from 'node:fs'; const compose=fs.readFileSync('/opt/waitron/compose.yml','utf8'); const config=JSON.parse(compose); console.log(JSON.stringify({compose,images:Object.fromEntries(Object.entries(config.services).filter(([name])=>name!=='tunnel').map(([name,s])=>[name,s.image]))}));`,
  );
  return `set -euxo pipefail
mkdir /run/a950-inputs
mount /dev/vdb /run/a950-inputs
state=$(docker volume create waitron_state)
state=$(docker volume inspect --format '{{.Mountpoint}}' "$state")
tar -xf /run/a950-inputs/source-state.tar -C "$state"
chown -R 10001:10001 "$state"
cp /run/a950-inputs/fixture-env.json /opt/waitron/fixture-env.json
umount /run/a950-inputs
cd /opt/waitron
COMPOSE_PROFILES=staff-tunnel docker compose config --format json >/run/a950-compose.json
${run(`import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; const c=JSON.parse(fs.readFileSync('/run/a950-compose.json','utf8')); Object.assign(c.services.app.environment,JSON.parse(fs.readFileSync('/opt/waitron/fixture-env.json','utf8'))); for(const [name,s] of Object.entries(c.services)){if(name!=='tunnel')s.image=execFileSync('docker',['image','inspect',s.image,'--format','{{.Id}}'],{encoding:'utf8'}).trim();} fs.writeFileSync('/opt/waitron/compose.yml',JSON.stringify(c));`)}
printf '%s\\n' ${quote(`#!/bin/bash\n${prepare}\n`)} >/opt/waitron-host/prepare-fixture.sh
mkdir /opt/waitron-host/probe-bin
printf '%s' ${quote(shim)} >/opt/waitron-host/probe-bin/cp
chmod 700 /opt/waitron-host/probe-bin/cp
timedatectl set-ntp true
sync
echo A950_STAGED
systemctl poweroff
`;
}

export function upgradePayload(mode) {
  if (mode === "manual")
    return `set -euxo pipefail
${start}
${apply} >/opt/waitron/success.json
jq -e '.phase=="committed" and .target=="candidate" and ([.checks[]|select(.name=="sale" and .ok==true and .details.total=="1.00" and .details.fiscalRecords==2)]|length)==1' /opt/waitron/success.json
${compare}
${failed}
${shell} restore
${compare}
${failed}
${shell} keep
${compare}
echo A950_MANUAL_OK
`;
  if (mode === "copy")
    return `set -euxo pipefail
${start}
A950_PROBE=copy PATH=/opt/waitron-host/probe-bin:$PATH ${apply}
`;
  if (mode === "held")
    return `set -euxo pipefail
if /usr/local/sbin/waitron-dev-start; then exit 1; fi
${cli} status /opt/waitron >/opt/waitron/status.json
jq -e '.phase=="awaiting-choice" and .copied==false' /opt/waitron/status.json
test -z "$(docker ps -q --filter label=com.docker.compose.project=waitron)"
${shell} restore
${compare}
echo A950_HELD_OK
`;
  if (mode === "restore")
    return `set -euxo pipefail
${start}
${failed}
A950_PROBE=restore PATH=/opt/waitron-host/probe-bin:$PATH ${shell} restore
`;
  if (mode === "restored")
    return `set -euxo pipefail
${start}
${compare}
test ! -e /var/lib/docker/volumes/waitron_state/_data/partial-restore
test -z "$(find /opt/waitron.upgrades -mindepth 1 -maxdepth 1 -print -quit)"
echo A950_RESTORED_OK
`;
  throw new Error("Unknown upgrade rehearsal mode");
}

export function upgradeUnit(payload) {
  return `[Unit]\nRequires=docker.service\nAfter=docker.service NetworkManager.service\nFailureAction=poweroff-force\n[Service]\nType=oneshot\nStandardOutput=tty\nStandardError=tty\nTTYPath=/dev/console\nExecStart=/bin/bash -ec 'printf %%s ${Buffer.from(payload).toString("base64")} | base64 -d | bash -e'\nTimeoutStartSec=900\n`;
}
