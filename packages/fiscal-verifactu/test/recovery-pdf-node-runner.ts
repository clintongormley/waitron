import { readFile } from "node:fs/promises";
import { renderRecoveryPdf } from "@waitron/fiscal-verifactu/recovery-pdf-node";

const document = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const locale = process.argv[3] as "en" | "es";
process.stdout.write(await renderRecoveryPdf(document, locale, process.argv[4]!));
