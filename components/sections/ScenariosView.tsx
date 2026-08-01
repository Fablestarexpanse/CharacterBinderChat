"use client";

// ─── Scenarios ────────────────────────────────────────────────────────────────
// Saved scene setups: standing scenario text + an opening message. Picked in
// the chat builder to override a character sheet's own scenario/greeting —
// one character, many stories.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Clapperboard, Plus, Trash2 } from "lucide-react";

export function ScenariosView() {
  const { scenarios, addScenario, updateScenario, deleteScenario } = useFableStore();

  // Destructive click needs a second, explicit confirmation click
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleNew = () => {
    addScenario({
      name: `Scenario ${scenarios.length + 1}`,
      scenario: "",
      firstMessage: "",
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Scenarios</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {scenarios.length} saved scene{scenarios.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="purple" size="md" onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Scenario
          </Button>
        </div>

        <p className="text-xs text-[var(--muted-fg)] mb-6">
          A scenario is a reusable scene setup — the situation the story opens in, plus the first
          message that kicks it off. Pick one when starting a chat to override the character
          sheet&apos;s own scenario and greeting.
        </p>

        {/* Empty state */}
        {scenarios.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <Clapperboard className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              No scenarios yet — save a scene setup to reuse it across chats and characters.
            </div>
          </div>
        )}

        <div className="space-y-6">
          {scenarios.map((sc) => (
            <Card key={sc.id}>
              <CardHeader className="flex items-center gap-3">
                <Clapperboard className="h-4 w-4 text-[var(--purple-fg)] flex-shrink-0" />
                <Input
                  value={sc.name}
                  onChange={(e) => updateScenario(sc.id, { name: e.target.value })}
                  placeholder="Scenario name"
                  className="flex-1 font-medium"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${confirmDelete === sc.id ? "text-red-500 bg-red-50" : "text-[var(--muted-fg)]"}`}
                  title={confirmDelete === sc.id ? "Click again to delete this scenario" : "Delete scenario"}
                  onClick={() => {
                    if (confirmDelete === sc.id) {
                      deleteScenario(sc.id);
                      setConfirmDelete(null);
                    } else {
                      setConfirmDelete(sc.id);
                      setTimeout(() => setConfirmDelete((v) => (v === sc.id ? null : v)), 3000);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardBody className="space-y-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-1">
                    Scenario — the situation the story opens in
                  </div>
                  <Textarea
                    value={sc.scenario}
                    onChange={(e) => updateScenario(sc.id, { scenario: e.target.value })}
                    placeholder="Where are we, what's happening, what's at stake…"
                    rows={4}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-1">
                    First message — how the character opens the scene (optional)
                  </div>
                  <Textarea
                    value={sc.firstMessage ?? ""}
                    onChange={(e) => updateScenario(sc.id, { firstMessage: e.target.value })}
                    placeholder="Leave empty to keep the character's own greeting"
                    rows={4}
                  />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
