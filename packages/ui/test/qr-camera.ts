import qrcode from "qrcode-generator";

/** A camera that films `text` as a QR code, drawn onto a canvas again every 50 ms so the stream
 * keeps sending frames. In Chromium only: this is not evidence about a real camera. */
export function cameraFilming(text: string): { stream: MediaStream; stop: () => void } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const cell = 6;
  const margin = 4;
  const size = (qr.getModuleCount() + margin * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const draw = () => {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#000";
    for (let row = 0; row < qr.getModuleCount(); row++) {
      for (let col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col))
          context.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
      }
    }
  };
  draw();
  const redraw = setInterval(draw, 50);
  const stream = canvas.captureStream(20);
  return { stream, stop: () => clearInterval(redraw) };
}
