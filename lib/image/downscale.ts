// ─── Avatar downscaling ───────────────────────────────────────────────────────
// Lives here rather than in the card importer: the character editor's avatar
// picker needs it for any uploaded image, card or not.

/**
 * Downscale an image to a compact data URL for use as an avatar. Full-size
 * card PNGs run to megabytes; the store (and its SQLite mirror) shouldn't
 * carry that per character.
 */
export function downscaleImage(file: Blob, maxDim = 512): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.fillStyle = "#ffffff"; // JPEG has no alpha — flatten on white
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.87));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
