"use client";

// ─── Memory Graph ─────────────────────────────────────────────────────────────
// Obsidian-style force-directed view of a chat's memory web: entities, facts,
// episodic scenes, insights, commitments, and the character↔player bond.
// Custom canvas force simulation — no graph library. Drag nodes, wheel to
// zoom, drag empty space to pan, hover for edge labels, click to highlight
// a node's neighbourhood.

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useDrawerRead } from "@/lib/hooks/useDrawerRead";
import type { GraphPayload } from "@/lib/api/dto";

// ─── Simulation types ─────────────────────────────────────────────────────────

interface SimNode {
  id: string; label: string; sub?: string;
  x: number; y: number; vx: number; vy: number;
  r: number; color: string; ring?: string;
  kind: string; fixed?: boolean; alwaysLabel: boolean;
}
interface SimLink {
  a: number; b: number; label: string;
  width: number; color: string; dashed?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  character: "#a78bfa",
  place:     "#22c55e",
  object:    "#f97316",
  faction:   "#4f9cf8",
  concept:   "#c084fc",
  literal:   "#9ca3af",
  episode:   "#eab308",
  insight:   "#22d3ee",
  commitment:"#f43f5e",
};

/** trust −100..100 → red..grey..green for the bond edge */
function bondColor(trust: number | null): string {
  if (trust === null) return "#9ca3af";
  const t = Math.max(-100, Math.min(100, trust)) / 100;
  const r = t < 0 ? 220 : Math.round(150 - 100 * t);
  const g = t > 0 ? 180 : Math.round(150 + 70 * t);
  return `rgb(${r}, ${g}, 110)`;
}

/** mood valence −1..1 → ring color for the character node */
function moodRing(valence: number): string {
  if (valence > 0.3) return "#22c55e";
  if (valence < -0.3) return "#ef4444";
  return "#eab308";
}

// Deterministic pseudo-random initial placement (stable across re-renders)
function hashAngle(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 3600) / 3600 * Math.PI * 2;
}

function buildSim(data: GraphPayload): { nodes: SimNode[]; links: SimLink[] } {
  const nodes: SimNode[] = [];
  const index = new Map<string, number>();
  const push = (n: SimNode) => { index.set(n.id, nodes.length); nodes.push(n); };

  for (const e of data.entities) {
    const major = e.isCharacter || e.isPlayer;
    const a = hashAngle(e.id);
    const d = major ? 30 : 150 + (a * 37) % 120;
    push({
      id: e.id,
      label: e.name,
      x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0,
      r: major ? 16 : 7,
      color: TYPE_COLORS[e.type] ?? "#9ca3af",
      ring: e.isCharacter && data.mood ? moodRing(data.mood.valence) : undefined,
      kind: e.type,
      alwaysLabel: major,
    });
  }
  for (const l of data.literals) {
    const a = hashAngle(l.id);
    push({
      id: l.id, label: l.name,
      x: Math.cos(a) * 220, y: Math.sin(a) * 220, vx: 0, vy: 0,
      r: 4, color: TYPE_COLORS.literal, kind: "literal", alwaysLabel: false,
    });
  }
  for (const c of data.cards) {
    const a = hashAngle(c.id);
    push({
      id: c.id, label: c.name, sub: c.content,
      x: Math.cos(a) * 180, y: Math.sin(a) * 180, vx: 0, vy: 0,
      r: 5 + c.importance * 6,
      color: TYPE_COLORS[c.kind], kind: c.kind, alwaysLabel: c.importance >= 0.7,
    });
  }
  for (const c of data.commitments) {
    const a = hashAngle(c.id);
    push({
      id: c.id, label: c.name, sub: `${c.status} promise`,
      x: Math.cos(a) * 160, y: Math.sin(a) * 160, vx: 0, vy: 0,
      r: 6,
      color: c.status === "active" ? TYPE_COLORS.commitment : "#9ca3af",
      kind: "commitment", alwaysLabel: false,
    });
  }

  const links: SimLink[] = [];
  const add = (aId: string, bId: string, label: string, width: number, color: string, dashed = false) => {
    const a = index.get(aId), b = index.get(bId);
    if (a === undefined || b === undefined || a === b) return;
    links.push({ a, b, label, width, color, dashed });
  };

  for (const l of data.links) {
    add(l.source, l.target, l.predicate, 0.6 + l.importance * 1.6, "#c4b5fd");
  }
  for (const c of data.cards) {
    for (const eid of c.entityIds) {
      add(c.id, eid, c.kind === "insight" ? "understood about" : "happened with",
        0.7, c.kind === "insight" ? "#67e8f9" : "#fde047", true);
    }
  }
  for (const c of data.commitments) {
    add(c.promisorId, c.id, "promised", 1.2, TYPE_COLORS.commitment, c.status !== "active");
    if (c.promiseeId) add(c.id, c.promiseeId, "to", 1.2, TYPE_COLORS.commitment, c.status !== "active");
  }

  // The emotional bond: one thick edge, colored by trust, width by connection
  const character = data.entities.find((e) => e.isCharacter);
  const player = data.entities.find((e) => e.isPlayer);
  if (character && player) {
    const trust = data.bond.trust ?? null;
    const conn  = data.bond.connection ?? 0;
    add(character.id, player.id,
      trust !== null ? `trust ${trust > 0 ? "+" : ""}${trust}` : "bond",
      2 + Math.abs(conn ?? 0) / 25, bondColor(trust));
  }

  return { nodes, links };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  chatId: string;
  characterId?: string;
  extractionVersion: number;
  /** larger canvas → stronger spread */
  full?: boolean;
}

export function MemoryGraph({ chatId, characterId, extractionVersion, full = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  // A failed read used to render the same "nothing mapped yet" as an empty
  // graph, so a broken endpoint read as a story with no memories.
  const { data, error, loading } = useDrawerRead<GraphPayload>(
    `${chatId}:${characterId}:${extractionVersion}`,
    `/api/drawer/graph?chatId=${encodeURIComponent(chatId)}` +
      (characterId ? `&characterId=${encodeURIComponent(characterId)}` : "")
  );

  // ── Simulation + rendering ────────────────────────────────────────────────
  useEffect(() => {
    if (!data || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { nodes, links } = buildSim(data);
    const view = { x: 0, y: 0, scale: 1 };
    let hover: number | null = null;
    let selected: number | null = null;
    let dragNode: number | null = null;
    let panning = false;
    let lastMouse = { x: 0, y: 0 };
    let raf = 0;
    let alpha = 1; // simulation heat — cools over time, reheats on drag

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = wrapRef.current!.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);

    const neighbours = new Map<number, Set<number>>();
    links.forEach((l) => {
      if (!neighbours.has(l.a)) neighbours.set(l.a, new Set());
      if (!neighbours.has(l.b)) neighbours.set(l.b, new Set());
      neighbours.get(l.a)!.add(l.b);
      neighbours.get(l.b)!.add(l.a);
    });

    const toWorld = (px: number, py: number) => {
      const rect = canvas.getBoundingClientRect();
      const cx = canvas.width / dpr / 2, cy = canvas.height / dpr / 2;
      return {
        x: (px - rect.left - cx - view.x) / view.scale,
        y: (py - rect.top - cy - view.y) / view.scale,
      };
    };

    const nodeAt = (wx: number, wy: number): number | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const d2 = (n.x - wx) ** 2 + (n.y - wy) ** 2;
        if (d2 < (n.r + 4) ** 2) return i;
      }
      return null;
    };

    const step = () => {
      // Forces: pairwise repulsion, spring links, weak centre gravity
      if (alpha > 0.005) {
        const springLen = full ? 90 : 62;
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
            const d = Math.sqrt(d2);
            const rep = Math.min(1400 / d2, 6) * alpha;
            const ux = dx / d, uy = dy / d;
            a.vx += ux * rep; a.vy += uy * rep;
            b.vx -= ux * rep; b.vy -= uy * rep;
          }
        }
        for (const l of links) {
          const a = nodes[l.a], b = nodes[l.b];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (d - springLen) * 0.02 * alpha;
          const ux = dx / d, uy = dy / d;
          a.vx += ux * f; a.vy += uy * f;
          b.vx -= ux * f; b.vy -= uy * f;
        }
        for (const n of nodes) {
          n.vx -= n.x * 0.0015 * alpha;
          n.vy -= n.y * 0.0015 * alpha;
          if (!n.fixed) {
            n.x += n.vx; n.y += n.vy;
          }
          n.vx *= 0.85; n.vy *= 0.85;
        }
        alpha *= 0.995;
      }

      // ── Draw ────────────────────────────────────────────────────────────
      const w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + view.x, h / 2 + view.y);
      ctx.scale(view.scale, view.scale);

      const focus = selected ?? hover;
      const inFocus = (i: number) =>
        focus === null || i === focus || neighbours.get(focus)?.has(i);

      for (const l of links) {
        const a = nodes[l.a], b = nodes[l.b];
        const dim = focus !== null && !(l.a === focus || l.b === focus);
        ctx.globalAlpha = dim ? 0.08 : 0.55;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width / view.scale ** 0.3;
        ctx.setLineDash(l.dashed ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Edge label on focus
        if (!dim && focus !== null && (l.a === focus || l.b === focus) && view.scale > 0.5) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#6b7280";
          ctx.font = `${9 / view.scale ** 0.5}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(l.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 3);
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dim = !inFocus(i);
        ctx.globalAlpha = dim ? 0.15 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        if (n.ring) {
          ctx.strokeStyle = n.ring;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (i === focus) {
          ctx.strokeStyle = "#111827";
          ctx.lineWidth = 1.5 / view.scale;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        const showLabel = n.alwaysLabel || i === focus || (focus !== null && neighbours.get(focus)?.has(i)) || view.scale > 1.6;
        if (showLabel && !dim) {
          ctx.fillStyle = "#374151";
          ctx.font = `${(n.alwaysLabel ? 11 : 9) / view.scale ** 0.4}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x, n.y + n.r + 11 / view.scale ** 0.4);
        }
      }
      ctx.globalAlpha = 1;

      // Hover card for episodes / insights / commitments
      if (hover !== null && nodes[hover].sub) {
        const n = nodes[hover];
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const text = n.sub!;
        ctx.font = "11px system-ui";
        const lines: string[] = [];
        let line = "";
        for (const word of text.split(" ")) {
          if (ctx.measureText(line + " " + word).width > 240) { lines.push(line); line = word; }
          else line = line ? line + " " + word : word;
        }
        if (line) lines.push(line);
        const bw = 260, bh = 18 + lines.length * 14;
        const bx = Math.min(w - bw - 8, Math.max(8, w / 2 + view.x + n.x * view.scale + 14));
        const by = Math.min(h - bh - 8, Math.max(8, h / 2 + view.y + n.y * view.scale + 14));
        ctx.fillStyle = "rgba(255,255,255,0.96)";
        ctx.strokeStyle = "#e5e7eb";
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#374151";
        ctx.textAlign = "left";
        lines.forEach((ln, k) => ctx.fillText(ln, bx + 10, by + 16 + k * 14));
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    // ── Interaction ─────────────────────────────────────────────────────────
    const onDown = (e: MouseEvent) => {
      const wpt = toWorld(e.clientX, e.clientY);
      const hit = nodeAt(wpt.x, wpt.y);
      lastMouse = { x: e.clientX, y: e.clientY };
      if (hit !== null) { dragNode = hit; nodes[hit].fixed = true; alpha = Math.max(alpha, 0.3); }
      else panning = true;
    };
    const onMove = (e: MouseEvent) => {
      const wpt = toWorld(e.clientX, e.clientY);
      if (dragNode !== null) {
        nodes[dragNode].x = wpt.x;
        nodes[dragNode].y = wpt.y;
        alpha = Math.max(alpha, 0.25);
      } else if (panning) {
        view.x += e.clientX - lastMouse.x;
        view.y += e.clientY - lastMouse.y;
        lastMouse = { x: e.clientX, y: e.clientY };
      } else {
        hover = nodeAt(wpt.x, wpt.y);
        canvas.style.cursor = hover !== null ? "pointer" : "grab";
      }
    };
    const onUp = (e: MouseEvent) => {
      if (dragNode !== null) {
        const moved = Math.hypot(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
        if (moved < 4) selected = selected === dragNode ? null : dragNode;
        nodes[dragNode].fixed = false;
        dragNode = null;
      } else if (panning) {
        const moved = Math.hypot(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
        if (moved < 4) selected = null;
      }
      panning = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      view.scale = Math.max(0.25, Math.min(4, view.scale * factor));
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [data, full]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[var(--muted-fg)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Mapping the story…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-xs text-red-600">The memory graph could not be loaded — {error}</p>
      </div>
    );
  }
  if (!data || (data.entities.length === 0 && data.cards.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-xs text-[var(--muted-fg)]">
          Nothing mapped yet — the web grows as you talk and memories form.
        </p>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {/* Legend */}
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/85 px-2.5 py-1.5 text-[9px] text-[var(--muted-fg)]">
        {[
          ["character", "Character"], ["place", "Place"], ["object", "Object"],
          ["faction", "Faction"], ["episode", "Scene"], ["insight", "Insight"],
          ["commitment", "Promise"],
        ].map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[k] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
