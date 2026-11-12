import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfPages(bytes: Uint8Array) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
  });
  const pdf = await task.promise;
  const read = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const size = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ");
    read.push({ width: size.width, height: size.height, text });
  }
  await task.destroy();
  return read;
}
