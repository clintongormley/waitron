import { openCertificateFile } from "./certificate-file.js";

let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (Buffer.byteLength(input) > 256 * 1024) process.exit(1);
}
const { pfx, passphrase } = JSON.parse(input) as { pfx: string; passphrase: string };
process.stdout.write(JSON.stringify(openCertificateFile(Buffer.from(pfx, "base64"), passphrase)));
