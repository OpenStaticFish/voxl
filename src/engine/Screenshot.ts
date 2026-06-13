// Screenshot capture. Because the renderer uses preserveDrawingBuffer:true,
// we can read the canvas pixels via toDataURL immediately after a render.
// We prefer the File System Access API when available (saves directly to a
// chosen path), and otherwise fall back to a browser download.

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept?: Record<string, string[]> }>;
  }) => Promise<FileSystemWritableFileStreamLike>;
}

interface FileSystemWritableFileStreamLike {
  write: (data: BlobPart) => Promise<void>;
  close: () => Promise<void>;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export async function captureScreenshot(canvas: HTMLCanvasElement, filename: string): Promise<string> {
  const blob = await toBlob(canvas);
  const w = window as unknown as SaveFilePickerWindow;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
      });
      await handle.write(blob);
      await handle.close();
      return filename;
    } catch {
      // user cancelled or unsupported — fall through to download
    }
  }
  // Fallback: trigger a download with the suggested filename.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}
