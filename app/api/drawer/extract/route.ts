import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import type { EntityType, StatName } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// ─── Extraction Prompt ────────────────────────────────────────────────────────

function buildExtractionPrompt(
  messages: Array<{ role: string; content: string }>,
  characterName: string
): string {
  const conversation = messages
    .slice(-12) // last 12 messages
    .map((m) => `${m.role === "user" ? "User" : characterName}: ${m.content}`)
    .join("\n\n");

  return `You are a memory extraction assistant for a roleplay story. Extract structured information from the conversation below.

Return ONLY valid JSON. No markdown, no explanation, just the JSON object.

{
  "entities": [
    { "id": "snake_case_id", "type": "character|place|object|faction|concept", "name": "Display Name", "description": "Brief description" }
  ],
  "facts": [
    { "subject": "entity_id", "predicate": "verb or relationship", "object": "entity_id or literal string", "confidence": 0.9 }
  ],
  "stat_changes": [
    { "observer": "entity_id", "target": "entity_id", "stat": "affection|trust|desire|connection|mood", "delta": 5 }
  ]
}

Rules:
- Only include entities actually mentioned or clearly implied
- Facts should be concrete statements: X knows Y, X is located at Y, X distrusts Y
- stat_changes reflect emotional/relational shifts; delta range -30 to +30 per exchange
- observer is the entity whose feelings/perspective is being tracked
- Use snake_case IDs derived from names (e.g. "ronan", "kaspar_division", "sector_7_checkpoint")
- If nothing meaningful to extract, return {"entities":[],"facts":[],"stat_changes":[]}
- Keep entity IDs consistent with prior extractions (use the same ID for the same entity)

Conversation to analyze:
${conversation}`;
}

// ─── LLM Callers ─────────────────────────────────────────────────────────────

async function callOllama(
  baseUrl: string,
  modelId: string,
  prompt: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:  modelId,
      prompt,
      stream: false,
      format: "json",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}

async function callOpenAICompat(
  baseUrl:  string,
  modelId:  string,
  prompt:   string,
  apiKey?:  string
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model:  modelId,
      stream: false,
      messages: [
        {
          role:    "user",
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "{}";
}

// ─── JSON Extractor ───────────────────────────────────────────────────────────

interface RawExtraction {
  entities: Array<{ id: string; type: string; name: string; description?: string }>;
  facts: Array<{ subject: string; predicate: string; object: string; confidence?: number }>;
  stat_changes: Array<{ observer: string; target: string; stat: string; delta: number }>;
}

function parseExtraction(text: string): RawExtraction {
  // Strip any markdown fences
  const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    return JSON.parse(clean) as RawExtraction;
  } catch {
    // Try to find JSON object inside the text
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as RawExtraction;
    return { entities: [], facts: [], stat_changes: [] };
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      characterId,
      characterName,
      providerType,
      providerBaseUrl,
      modelId,
      apiKey,
    } = body as {
      messages:        Array<{ role: string; content: string }>;
      characterId:     string;
      characterName:   string;
      providerType:    "ollama" | "lmstudio" | "openrouter";
      providerBaseUrl: string;
      modelId:         string;
      apiKey?:         string;
    };

    if (!messages?.length || !characterId || !providerBaseUrl || !modelId) {
      return Response.json(
        { error: "messages, characterId, providerBaseUrl and modelId are required" },
        { status: 400 }
      );
    }

    // ── Call LLM ──────────────────────────────────────────────────────────

    const prompt = buildExtractionPrompt(messages, characterName ?? characterId);
    let rawText: string;

    if (providerType === "ollama") {
      rawText = await callOllama(providerBaseUrl, modelId, prompt);
    } else {
      rawText = await callOpenAICompat(providerBaseUrl, modelId, prompt, apiKey);
    }

    const extracted = parseExtraction(rawText);
    const store     = getStore();

    // ── Ensure the main character entity exists ───────────────────────────

    store.ensureEntity(characterId, "character", characterName ?? characterId);

    // ── Write extracted entities ──────────────────────────────────────────

    const writtenEntities: string[] = [];
    for (const e of extracted.entities ?? []) {
      if (!e.id || !e.name) continue;
      const validTypes = ["character", "place", "object", "faction", "concept"];
      const type = validTypes.includes(e.type) ? (e.type as EntityType) : "character";
      store.ensureEntity(e.id, type, e.name, e.description ?? "");
      writtenEntities.push(e.id);
    }

    // ── Write extracted facts ─────────────────────────────────────────────

    const writtenFacts: number[] = [];
    for (const f of extracted.facts ?? []) {
      if (!f.subject || !f.predicate || !f.object) continue;

      // Make sure subject exists
      if (!store.getEntity(f.subject)) {
        store.ensureEntity(f.subject, "character", f.subject);
      }

      // Determine if object is an entity ID or a literal
      const objectEntity = store.getEntity(f.object);
      const factId = store.insertFact({
        subjectId:     f.subject,
        predicate:     f.predicate,
        objectId:      objectEntity ? f.object : null,
        objectLiteral: objectEntity ? null : f.object,
        confidence:    f.confidence ?? 0.85,
      });
      writtenFacts.push(factId);
    }

    // ── Write stat changes ────────────────────────────────────────────────

    const writtenStats: string[] = [];
    const validStats = ["affection", "trust", "desire", "connection", "mood"];
    for (const sc of extracted.stat_changes ?? []) {
      if (!sc.observer || !sc.target || !validStats.includes(sc.stat)) continue;
      if (typeof sc.delta !== "number") continue;

      store.ensureEntity(sc.observer, "character", sc.observer);
      store.ensureEntity(sc.target,   "character", sc.target);
      store.deltaStat(sc.observer, sc.target, sc.stat as StatName, sc.delta);
      writtenStats.push(`${sc.observer}->${sc.target}:${sc.stat}(${sc.delta > 0 ? "+" : ""}${sc.delta})`);
    }

    return Response.json({
      ok:       true,
      entities: writtenEntities,
      facts:    writtenFacts,
      stats:    writtenStats,
      rawModel: rawText.slice(0, 200) + (rawText.length > 200 ? "…" : ""),
    });
  } catch (err) {
    console.error("[drawer/extract]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
