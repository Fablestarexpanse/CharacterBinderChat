"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PNG / JSON download buttons for a card. Runs the export and shows its failure
 * in place — a download that silently does nothing reads as a broken button.
 * `png` can be switched off for kinds that have no art to carry (the PNG is then
 * just a 1×1 image around the JSON).
 */
export function ExportButtons({
  run, png = true,
}: {
  run: (format: "png" | "json") => Promise<unknown>;
  png?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const go = (format: "png" | "json") => async (e: React.MouseEvent) => {
    e.stopPropagation();                 // sits inside clickable cards
    setError(null);
    try { await run(format); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  return (
    <span className="inline-flex items-center gap-1">
      {png && (
        <Button variant="outline" size="sm" title="Download as a PNG card" onClick={go("png")}>
          <Download className="h-3 w-3 mr-1" />PNG
        </Button>
      )}
      <Button variant="outline" size="sm" title="Download as JSON" onClick={go("json")}>
        {png ? "JSON" : <><Download className="h-3 w-3 mr-1" />Export</>}
      </Button>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </span>
  );
}
