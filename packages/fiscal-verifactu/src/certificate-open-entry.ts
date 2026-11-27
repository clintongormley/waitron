import { openCertificateFile } from "./certificate-file.js";
import { openOrRewrite, type RewrittenResult } from "./certificate-convert.js";

process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (Buffer.byteLength(input) > 256 * 1024) process.exit(1);
}
const { pfx, passphrase, rewriteOld } = JSON.parse(input) as {
  pfx: string;
  passphrase: string;
  rewriteOld: boolean;
};
const file = Buffer.from(pfx, "base64");
const result: RewrittenResult = rewriteOld
  ? openOrRewrite(file, passphrase)
  : openCertificateFile(file, passphrase);
process.stdout.write(
  JSON.stringify(
    result.ok && result.rewritten !== undefined
      ? { ...result, rewritten: result.rewritten.toString("base64") }
      : result,
  ),
);
