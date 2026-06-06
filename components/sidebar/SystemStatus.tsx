"use client";

import { useEffect } from "react";
import { useFableStore } from "@/lib/store";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import { ComfyUIProvider } from "@/lib/providers/comfyui";
import type { ProviderId } from "@/lib/types";
import { Cpu, MemoryStick, Activity } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ connected, checking }: { connected: boolean; checking: boolean }) {
  if (checking) return <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />;
  return (
    <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${connected ? "bg-green-500" : "bg-[var(--border)]"}`} />
  );
}

/** Shorten a model ID to fit in ~14 chars for the sidebar */
function shortenModel(id: string): string {
  // Remove common prefixes like "anthropic/" "openai/" "google/"
  const short = id.replace(/^[a-z-]+\//, "");
  return short.length > 16 ? short.slice(0, 15) + "…" : short;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SystemStatus() {
  const { providerStatuses, setProviderStatus, providerSettings } = useFableStore();

  useEffect(() => {
    const check = async () => {
      const providers: Array<{
        id:          ProviderId;
        check:       () => Promise<boolean>;
        getLabel?:   () => Promise<string>;
      }> = [
        {
          id:    "ollama",
          check: () => new OllamaProvider(providerSettings.ollama.baseUrl).checkConnection(),
          getLabel: async () => {
            const models = await new OllamaProvider(providerSettings.ollama.baseUrl).listModels();
            if (models.length === 0) return "no models";
            if (models.length === 1) return shortenModel(models[0].id);
            return `${models.length} models`;
          },
        },
        {
          id:    "lmstudio",
          check: () => new LMStudioProvider(providerSettings.lmstudio.baseUrl).checkConnection(),
          getLabel: async () => {
            const models = await new LMStudioProvider(providerSettings.lmstudio.baseUrl).listModels();
            if (models.length === 0) return "no model loaded";
            return shortenModel(models[0].name ?? models[0].id);
          },
        },
        {
          id:    "openrouter",
          check: () => new OpenRouterProvider(providerSettings.openrouter.apiKey).checkConnection(),
          // OpenRouter has hundreds of models — just show "online"
        },
        {
          id:    "comfyui",
          check: () => new ComfyUIProvider(providerSettings.comfyui.baseUrl).checkConnection(),
        },
      ];

      // Mark all as checking simultaneously
      providers.forEach((p) => setProviderStatus(p.id, { checking: true }));

      // Run all checks in parallel — offline providers resolve after their timeout, not one-by-one
      await Promise.allSettled(
        providers.map(async (p) => {
          const connected = await p.check();
          let modelLabel: string | undefined;
          if (connected && p.getLabel) {
            try { modelLabel = await p.getLabel(); } catch { /* ignore */ }
          }
          setProviderStatus(p.id, { connected, checking: false, modelLabel });
        })
      );
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerSettings]);

  return (
    <div className="px-3 py-3 border-t border-[var(--sidebar-border)]">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-2">
        System
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-white p-2.5 space-y-1.5">
        {providerStatuses.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5">
            <StatusDot connected={p.connected} checking={p.checking} />
            <span className="text-[11px] text-[var(--foreground)] w-16 flex-shrink-0">{p.name}</span>
            <span
              className={`text-[10px] truncate min-w-0 ${
                p.checking
                  ? "text-[var(--muted-fg)]"
                  : p.connected
                  ? p.modelLabel && p.modelLabel !== "no models" && p.modelLabel !== "no model loaded"
                    ? "text-green-700 font-medium"
                    : "text-green-600"
                  : "text-[var(--muted-fg)]"
              }`}
              title={p.connected && p.modelLabel ? p.modelLabel : undefined}
            >
              {p.checking
                ? "…"
                : p.connected
                ? (p.modelLabel ?? "online")
                : "offline"}
            </span>
          </div>
        ))}

        {/* Resource placeholders */}
        <div className="pt-1.5 mt-0.5 border-t border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[var(--muted-fg)]">
              <Cpu className="h-3 w-3" />
              <span className="text-[11px]">GPU</span>
            </div>
            <span className="text-[10px] text-[var(--muted-fg)]">— %</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[var(--muted-fg)]">
              <MemoryStick className="h-3 w-3" />
              <span className="text-[11px]">VRAM</span>
            </div>
            <span className="text-[10px] text-[var(--muted-fg)]">— GB</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[var(--muted-fg)]">
              <Activity className="h-3 w-3" />
              <span className="text-[11px]">RAM</span>
            </div>
            <span className="text-[10px] text-[var(--muted-fg)]">— GB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
