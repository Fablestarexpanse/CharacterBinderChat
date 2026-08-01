"use client";

// ─── Image lightbox ───────────────────────────────────────────────────────────
// In-app full-size image viewer. Clicking a generated image used to
// window.open the raw file, which navigated away from the chat with no way
// back — this overlays instead: Esc, the X, or clicking outside returns to
// exactly where you were.

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function ImageLightbox({
  url,
  filename,
  onClose,
}: {
  url: string | null;
  filename: string;
  onClose: () => void;
}) {
  const handleDownload = async () => {
    if (!url) return;
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  return (
    <Dialog open={url !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92vw] w-auto p-3" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Generated image</DialogTitle>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- local ComfyUI output
          <img
            src={url}
            alt="Generated image, full size"
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
        )}
        <div className="flex justify-end mt-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
