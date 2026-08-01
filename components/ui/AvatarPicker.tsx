"use client";

// ─── Avatar picker ────────────────────────────────────────────────────────────
// Click the portrait to choose an image file. Picked images run through the
// same downscale-to-data-URI path as CharacterBinder PNG imports, so a chosen
// avatar is stored exactly like an imported one (≤512px JPEG) and survives a
// cache clear via the SQLite mirror. Pasting a URL still works underneath.

import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downscaleImage } from "@/lib/import/cardFile";
import { Upload, X, Loader2 } from "lucide-react";

export function AvatarPicker({
  name,
  value,
  onChange,
}: {
  /** Display name — drives the initials placeholder */
  name: string;
  /** Data URI or URL, "" when unset */
  value: string;
  onChange: (next: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a removal
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUri = await downscaleImage(file);
      if (dataUri) onChange(dataUri);
      else setError("Couldn't read that image — try a PNG, JPEG or WebP.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--foreground)]">
        Portrait
        <span className="ml-1.5 font-normal text-[var(--muted-fg)]">
          optional — initials are shown without one
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Choose an image"
          className="relative rounded-full cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--purple)]"
        >
          <Avatar name={name || "?"} src={value.trim() || undefined} size="lg" />
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            </span>
          )}
        </button>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="mr-1.5 h-3 w-3" />
              {value ? "Replace image" : "Upload image"}
            </Button>
            {value && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[var(--muted-fg)]"
                onClick={() => { onChange(""); setError(null); }}
                disabled={busy}
              >
                <X className="mr-1 h-3 w-3" />
                Remove
              </Button>
            )}
          </div>
          <Input
            value={value.startsWith("data:") ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={value.startsWith("data:") ? "Uploaded image" : "…or paste a URL"}
            disabled={value.startsWith("data:")}
            className="text-xs h-8"
          />
        </div>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
