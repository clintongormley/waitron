import { answerOpener } from "./certificate-open-answer.js";

process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (Buffer.byteLength(input) > 256 * 1024) process.exit(1);
}
process.stdout.write(await answerOpener(input));
