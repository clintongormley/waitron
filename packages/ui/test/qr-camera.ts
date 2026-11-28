import qrcode from "qrcode-generator";

const CELL = 6;
const MARGIN = 4;
/** Room for any code these tests film; a smaller code is drawn in its top-left corner. */
const SIZE = 360;

/** A camera that films `text` as a QR code, drawn onto a canvas again every 50 ms so the stream
 * keeps sending frames. In Chromium only: this is not evidence about a real camera. */
export function cameraFilming(text: string): { stream: MediaStream; stop: () => void } {
  return cameraShowing(text);
}

/** As `cameraFilming`, but `show` changes what it films; `null` films a blank picture. */
export function cameraShowing(first: string | null): {
  stream: MediaStream;
  show: (text: string | null) => void;
  stop: () => void;
} {
  let shown = first === null ? null : encode(first);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  const draw = () => {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, SIZE, SIZE);
    if (shown === null) return;
    context.fillStyle = "#000";
    for (let row = 0; row < shown.getModuleCount(); row++) {
      for (let col = 0; col < shown.getModuleCount(); col++) {
        if (shown.isDark(row, col))
          context.fillRect((col + MARGIN) * CELL, (row + MARGIN) * CELL, CELL, CELL);
      }
    }
  };
  draw();
  const redraw = setInterval(draw, 50);
  const stream = canvas.captureStream(20);
  return {
    stream,
    show: (text) => {
      shown = text === null ? null : encode(text);
      draw();
    },
    stop: () => clearInterval(redraw),
  };
}

function encode(text: string): ReturnType<typeof qrcode> {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr;
}
