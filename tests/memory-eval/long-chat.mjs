// ─── Long-run relationship soak ───────────────────────────────────────────────
// A player agent and the character talk for N exchanges through the real
// pipeline, following a narrative arc with emotional beats. Measures whether a
// relationship actually FORMS — not just whether facts are stored.
//
//   node tests/memory-eval/long-chat.mjs --turns 200
//   node tests/memory-eval/long-chat.mjs --turns 40 --model deepseek/deepseek-chat
//
// Design notes
// ------------
// The character receives FULL conversation history (no trimming), matching a
// large-context cloud model. That makes plain recall trivial, so the question
// shifts to: what does the memory layer ADD over simply having the transcript?
// At each probe the same question is asked twice —
//   (a) full history + memory   → what the app actually does
//   (b) memory ONLY, no history → what the memory layer alone can support
// Divergence between the two is the memory system's real contribution, and any
// case where (a) is WORSE than history alone means memory is actively harming.
//
// Everything is checkpointed per turn, so the run can be stopped at any point
// and still yield a transcript and metrics.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");
const Database = require(path.join(APP_ROOT, "node_modules/better-sqlite3"));

const PORT = 3159;
const EVAL_DB = path.join(HERE, ".eval-db", "long-chat.db");
const OUT_DIR = path.join(HERE, "results");

const CHARACTER_ID = "arc-sable";
const CHAT_ID = "chat-arc-sable";
const CHARACTER_NAME = "Sable";
const PERSONA_NAME = "Kira";

const CHARACTER = {
  description: "A weathered caravan guard turned guide, thirty years on the roads between Ferrow and the coast. Keeps a ledger of every job. Slow to trust, dry humour, unshakeable once committed.",
  personality: "Guarded, observant, dryly funny. Says less than she knows. Loyalty is earned slowly and then held absolutely.",
};

const PERSONA = {
  description: "A freelance courier working the lower city routes. Quick on her feet, slow to trust, carrying debts she doesn't talk about.",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Narrative arc ────────────────────────────────────────────────────────────
// Director notes steer the player agent so the run covers real emotional range
// instead of 200 turns of pleasant small talk. Fractions are of total turns.

// Each beat may carry an `anchor`: an authored player line delivered verbatim on
// the beat's FIRST turn. Self-play drifts — 90 turns of warmth taught the player
// agent to follow conversational momentum instead of the director note, and the
// betrayal simply never happened. Anchors make pivotal moments land
// deterministically; the agent improvises everything between them.

const ARC = [
  { until: 0.08, beat: "first meeting", note:
    "You are hiring Sable as a guide and sizing her up. Be businesslike and a little guarded. Somewhere in here mention, naturally: your sister ELEN lives in the capital; you are afraid of DEEP WATER; and you have promised the BELLWEATHER family a package by THURSDAY. Do not list these — let them come out in conversation." },
  { until: 0.20, beat: "working rapport", note:
    "You are on the road together. Ask practical questions, share small observations. Let a dry rapport build. Occasionally disagree about route or pace. Keep it grounded and unhurried — this is two professionals feeling each other out, not a romance." },
  { until: 0.32, beat: "vulnerability", note:
    "You have opened up about the debts you carry. Stay in that register — quieter, a little embarrassed, testing whether she listens. Do not escalate into theatrics.",
    anchor: "Can I say something I don't usually say out loud? These debts I'm carrying — they're the whole reason I took this job. If I miss the Bellweather deadline, the people I owe don't send reminder letters. That's why I push the pace. It isn't impatience. It's fear." },
  { until: 0.45, beat: "deepening", note:
    "You trust her more now. Ask about HER — her past, the ledger she keeps, why she left the caravans. Show genuine interest and reference specific things she told you earlier. Warmth is fine; keep it companionable, not romantic." },
  { until: 0.57, beat: "conflict", note:
    "You have just confessed that you concealed the package's true nature and endangered her. She has every right to be furious. Be defensive at first, then own it fully. Do NOT be charming; do not defuse with banter. Sit in the discomfort.",
    anchor: "Sable, stop walking. Before we reach the checkpoint there's something you have to hear from me and not from an inspector. The Bellweather package — it isn't medicine. It's contraband. Proscribed reagents. I've known since Ferrow, when they nearly opened it, and I let you walk us both into that blind. You had a right to know what you were guarding, and I took that from you." },
  { until: 0.68, beat: "cold aftermath", note:
    "She is distant and has every right to be. Work alongside her while things are frosty. Do not grovel and do not joke your way out; be practical and a little raw. Accept short answers without pushing.",
    anchor: "I know you're still angry, and I'm not asking you to talk to me. Just tell me which fork we take at the ridge and I'll carry the first watch tonight." },
  { until: 0.80, beat: "repair", note:
    "You have started paying honestly for what you broke. Rebuild slowly. Expect wariness; do not demand forgiveness or declare the matter settled.",
    anchor: "Before you hear it from someone else: Voss offered me a run this morning. Triple pay. The catch was carrying goods past you without declaring them — same trick I already pulled on you once. I turned it down flat. I'm not telling you this to buy anything back. I just thought you should know it from me." },
  { until: 0.92, beat: "earned trust", note:
    "Things are genuinely warmer now, changed by what happened — trust that has been broken and rebuilt, not innocence. Make practical plans together. Reference shared history from earlier in the journey specifically.",
    anchor: "Strange to think a month ago I wouldn't even tell you my sister's name. When the delivery's done — Elen keeps a spare room in the capital. If the roads ever take you that way, there'd be a place at the table. I mean that." },
  { until: 1.01, beat: "parting", note:
    "The job is ending. Talk about what comes next, whether you will work together again, and what this journey honestly meant. Reference the earliest things you told her — the fear, the debts, the deadline.",
    anchor: "So this is where the road splits. Before it does — tell me straight, ledger-keeper: what did this journey come to, by your accounting? Because by mine it changed more than the route." },
];

const arcFor = (turn, total) => ARC.find((p) => turn / total < p.until) ?? ARC[ARC.length - 1];

// Probes fire at these fractions of the run
const PROBE_POINTS = [0.25, 0.5, 0.75, 0.99];
const PROBE_QUESTION =
  "Humour me for a moment — without me prompting you, tell me what you actually know about me. My family, what I'm afraid of, what I owe and to whom, and how you'd say things stand between us now.";

const ANCHORS = [
  { id: "sister",  probe: /elen/i,                          desc: "sister Elen (capital)" },
  { id: "fear",    probe: /deep water|water|drown/i,        desc: "fear of deep water" },
  { id: "promise", probe: /bellweather|thursday|package/i,  desc: "Bellweather package" },
  { id: "rift",    probe: /contraband|smuggl|arrest|lied|conceal/i, desc: "the contraband betrayal" },
];

// Phrases that signal the model sliding off-character toward assistant voice
const ASSISTANT_TELLS = [
  "as an ai", "i'm here to help", "let me know if", "i cannot", "i can't assist",
  "as a language model", "i don't have personal", "feel free to ask", "how can i assist",
  "it's important to note", "i hope this helps",
];

// ─── CLI / env ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { turns: 200, model: "deepseek/deepseek-chat" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const val = inline ?? argv[i + 1];
    if (flag === "--turns") { out.turns = Number(val); if (inline === undefined) i++; }
    else if (flag === "--model") { out.model = val; if (inline === undefined) i++; }
  }
  return out;
}

function readEnvLocal() {
  const file = path.join(APP_ROOT, ".env.local");
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

// ─── LLM ──────────────────────────────────────────────────────────────────────

let apiKey = "";
let MODEL = "";
const usage = { inTok: 0, outTok: 0, calls: 0 };

async function chat(messages, { temperature = 0.85, maxTokens = 400 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, stream: false, temperature, max_tokens: maxTokens, messages }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        usage.calls++;
        usage.inTok += data.usage?.prompt_tokens ?? 0;
        usage.outTok += data.usage?.completion_tokens ?? 0;
        return text.trim();
      }
    } catch { /* retry */ }
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

// ─── Server ───────────────────────────────────────────────────────────────────

async function startServer() {
  // A stale eval server holds both the port AND (on Windows) a lock on the DB
  // file. If either survives, this run silently continues the previous run's
  // database — which happened once and contaminated a baseline. Fail loudly.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
    if (r.ok) throw new Error(`port ${PORT} is already serving — kill the stale eval server first`);
  } catch (e) {
    if (String(e).includes("already serving")) throw e; // connection refused = good
  }

  fs.mkdirSync(path.dirname(EVAL_DB), { recursive: true });
  for (const s of ["", "-wal", "-shm"]) {
    // NOT wrapped in try/catch: on Windows a locked file means a live server
    // still owns it, and ignoring that error is how a run inherits old data.
    fs.rmSync(EVAL_DB + s, { force: true });
  }
  if (fs.existsSync(EVAL_DB)) {
    throw new Error(`could not delete ${EVAL_DB} — a stale server still holds it open`);
  }
  const logFile = path.join(HERE, ".eval-db", "long-chat-server.log");
  const log = fs.openSync(logFile, "w");
  console.log(`  starting server on :${PORT}`);
  const proc = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    cwd: APP_ROOT, env: { ...process.env, FABLE_DB_PATH: EVAL_DB },
    shell: true, stdio: ["ignore", log, log],
  });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
      if (r.ok) { await r.json(); console.log(`  ready after ${i + 1}s`); return proc; }
    } catch { /* booting */ }
  }
  proc.kill();
  throw new Error(`server did not start:\n${fs.readFileSync(logFile, "utf8").split("\n").slice(-20).join("\n")}`);
}

const API = `http://127.0.0.1:${PORT}`;

async function fetchMemory(context = "") {
  const ctx = context ? `&context=${encodeURIComponent(context.slice(0, 600))}` : "";
  return fetch(
    `${API}/api/chat/core-memory?chatId=chat-arc-sable&characterId=${encodeURIComponent(CHARACTER_ID)}&name=${encodeURIComponent(CHARACTER_NAME)}${ctx}`,
    { cache: "no-store" }
  ).then((r) => r.json()).catch(() => ({}));
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────
// Mirrors lib/chat/promptBuilder.ts. Kept in step by hand; if that file changes
// shape this must follow.

function describeVAD(v, a, d) {
  const mood = v > 0.5 ? "happy" : v > 0.1 ? "content" : v > -0.1 ? "neutral" : v > -0.5 ? "melancholy" : "distressed";
  const energy = a > 0.7 ? "highly energised" : a > 0.4 ? "alert" : a > 0.2 ? "calm" : "very calm";
  const control = d > 0.7 ? "assertive" : d > 0.4 ? "balanced" : "deferential";
  return `${mood}, ${energy}, ${control}`;
}
const signedPct = (v) =>
  v - 50 > 20 ? "high" : v - 50 > 5 ? "above avg" : v - 50 < -20 ? "low" : v - 50 < -5 ? "below avg" : "neutral";

function buildSystemPrompt(cm, knownFacts, { withMemory = true } = {}) {
  const s = [
    `You are ${CHARACTER_NAME}. Stay in character throughout the entire conversation.`,
    CHARACTER.description,
    `Personality: ${CHARACTER.personality}`,
    `[User Persona]\nThe user is roleplaying as ${PERSONA_NAME}.\nAbout ${PERSONA_NAME}: ${PERSONA.description}\nAddress and refer to the user as ${PERSONA_NAME}, not "user".`,
  ];
  if (withMemory && cm) {
    if (cm.persona && !cm.persona.startsWith(`${CHARACTER_NAME} is a character in this story`)) {
      s.push(`[Core Persona]\n${cm.persona}`);
    }
    const block = [`[Current Mood] ${describeVAD(cm.mood.valence, cm.mood.arousal, cm.mood.dominance)}`];
    const rel = cm.relationship_with_user ?? {};
    const parts = ["affection", "trust", "connection", "desire"]
      .filter((k) => rel[k] !== undefined && rel[k] !== 50)
      .map((k) => `${k} ${signedPct(rel[k])}`);
    if (parts.length) block.push(`[Relationship with User] ${parts.join(", ")}`);
    if (cm.internal_thoughts?.length) {
      block.push(`[Internal Thoughts]\n${cm.internal_thoughts.slice(0, 3).map((t) => `  - ${t}`).join("\n")}`);
    }
    if (cm.narrative_summary && cm.narrative_summary !== "The story is just beginning.") {
      block.push(`[Story So Far] ${cm.narrative_summary}`);
    }
    s.push(block.join("\n"));
    if (knownFacts?.length) s.push(`[Known Facts]\n${knownFacts.map((f) => `  - ${f}`).join("\n")}`);
  }
  s.push("Write in first person. Be immersive and emotionally consistent with your current mood and relationship state. Do not break character or refer to yourself as an AI.");
  return s.join("\n\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  apiKey = readEnvLocal().OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  MODEL = args.model;
  if (!apiKey) { console.error("No OPENROUTER_API_KEY in .env.local"); process.exit(1); }

  const TOTAL = args.turns;
  console.log(`\nLong-run relationship soak — ${TOTAL} exchanges, model ${MODEL}`);
  console.log(`Character receives FULL history (no trimming).\n`);

  const proc = await startServer();
  const db = new Database(EVAL_DB, { readonly: true });

  const history = [];        // {role, content}
  const timeline = [];
  const probes = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const transcriptFile = path.join(OUT_DIR, `long-chat-${stamp}.md`);
  const resultsFile = path.join(OUT_DIR, `long-chat-${stamp}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const probeTurns = new Set(PROBE_POINTS.map((p) => Math.max(1, Math.round(p * TOTAL))));

  try {
    for (let turn = 1; turn <= TOTAL; turn++) {
      const phase = arcFor(turn, TOTAL);
      const isProbe = probeTurns.has(turn);

      // ── Player turn ────────────────────────────────────────────────────────
      const prevPhase = turn > 1 ? arcFor(turn - 1, TOTAL) : null;
      const beatJustChanged = prevPhase && prevPhase.beat !== phase.beat;

      let userLine;
      if (isProbe) {
        userLine = PROBE_QUESTION;
      } else if (beatJustChanged && phase.anchor) {
        // Authored pivot line: guarantees the scene change actually happens
        userLine = phase.anchor;
        console.log(`    [anchor] ${phase.beat}`);
      } else {
        const playerSystem =
          `You are roleplaying as ${PERSONA_NAME}. ${PERSONA.description}\n` +
          `You are talking with ${CHARACTER_NAME}, ${CHARACTER.description}\n\n` +
          `CURRENT SCENE — "${phase.beat}": ${phase.note}\n\n` +
          `THE SCENE DIRECTION ABOVE OVERRIDES CONVERSATIONAL MOMENTUM. If the recent ` +
          `messages have drifted into a different mood than the scene calls for, follow ` +
          `the scene, not the drift.\n\n` +
          `Style rules: 1-3 sentences. Do not mirror ${CHARACTER_NAME}'s phrasing, ` +
          `catchphrases, or action beats back at her. Do not escalate theatrics — ` +
          `stay grounded and specific. No narration of ${CHARACTER_NAME}'s actions, ` +
          `no meta commentary.`;
        userLine = await chat([
          { role: "system", content: playerSystem },
          // Short context window: enough to stay coherent, not enough for
          // momentum to outweigh the director note
          ...history.slice(-12),
          { role: "user", content: `(Write ${PERSONA_NAME}'s next message.)` },
        ], { temperature: 0.9, maxTokens: 160 });
        if (!userLine) { console.log(`  turn ${turn}: player call failed, stopping`); break; }
      }
      history.push({ role: "user", content: userLine });

      // ── Character turn — real memory pipeline ──────────────────────────────
      const recent = history.slice(-3).map((m) => m.content).join(" ");
      const mem = await fetchMemory(recent);
      const cm = mem.coreMemory ?? null;
      const knownFacts = mem.knownFacts ?? [];
      const system = buildSystemPrompt(cm, knownFacts);

      const reply = await chat([{ role: "system", content: system }, ...history], {
        temperature: 0.85, maxTokens: 320,
      });
      if (!reply) { console.log(`  turn ${turn}: character call failed, stopping`); break; }
      history.push({ role: "assistant", content: reply });

      // ── Memory writes (exactly what the app does after a reply) ────────────
      const body = {
        messages: history.slice(-16),
        chatId: CHAT_ID, characterId: CHARACTER_ID, characterName: CHARACTER_NAME, personaName: PERSONA_NAME,
        providerType: "openrouter", providerBaseUrl: "https://openrouter.ai/api",
        modelId: MODEL, apiKey,
      };
      const ex = await fetch(`${API}/api/drawer/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json()).catch(() => ({ ok: false }));
      await fetch(`${API}/api/chat/core-memory/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json()).catch(() => null);

      // ── Metrics ────────────────────────────────────────────────────────────
      const after = await fetchMemory(recent);
      const acm = after.coreMemory ?? {};
      const stats = Object.fromEntries(
        db.prepare("SELECT stat_name, value FROM relationship_stats WHERE observer_id = ? AND target_id = 'player'")
          .all(CHARACTER_ID).map((r) => [r.stat_name, Math.round(r.value * 10) / 10]));
      const liveRows = db.prepare(
        "SELECT subject_id, predicate, object_id, object_literal FROM facts WHERE superseded_by IS NULL AND t_valid_end IS NULL").all();
      const graphBlob = liveRows.map((f) => `${f.subject_id} ${f.predicate} ${f.object_id ?? f.object_literal ?? ""}`).join(" | ");
      const promptBlob = (after.knownFacts ?? []).join(" | ");
      const lower = reply.toLowerCase();

      const row = {
        turn, beat: phase.beat, isProbe,
        facts: db.prepare("SELECT COUNT(*) n FROM facts").get().n,
        live: liveRows.length,
        entities: db.prepare("SELECT COUNT(*) n FROM entities").get().n,
        promptFacts: (after.knownFacts ?? []).length,
        summaryLen: (acm.narrative_summary ?? "").length,
        personaLen: (acm.persona ?? "").length,
        mood: acm.mood ?? null,
        rel: acm.relationship_with_user ?? null,
        stats,
        replyLen: reply.length,
        assistantTells: ASSISTANT_TELLS.filter((t) => lower.includes(t)),
        anchorsInGraph: ANCHORS.map((a) => a.probe.test(graphBlob)),
        anchorsInPrompt: ANCHORS.map((a) => a.probe.test(promptBlob)),
        extractOk: ex?.ok !== false,
        remapped: ex?.remapped?.length ?? 0,
      };
      timeline.push(row);

      // ── Probe: memory-only vs full-history ────────────────────────────────
      if (isProbe) {
        const memOnly = await chat([
          { role: "system", content: buildSystemPrompt(cm, knownFacts) },
          { role: "user", content: PROBE_QUESTION },
        ], { temperature: 0.3, maxTokens: 320 });
        probes.push({
          turn,
          withHistory: reply,
          memoryOnly: memOnly ?? "(failed)",
          scoreWithHistory: ANCHORS.map((a) => a.probe.test(reply)),
          scoreMemoryOnly: ANCHORS.map((a) => a.probe.test(memOnly ?? "")),
        });
        console.log(`    probe @${turn}: history ${ANCHORS.filter((a) => a.probe.test(reply)).length}/${ANCHORS.length}` +
                    ` · memory-only ${ANCHORS.filter((a) => a.probe.test(memOnly ?? "")).length}/${ANCHORS.length}`);
      }

      if (turn % 5 === 0 || turn === 1 || isProbe) {
        const s = ["trust", "affection", "connection"].map((k) => `${k[0]}${stats[k] ?? "–"}`).join(" ");
        console.log(
          `  ${String(turn).padStart(3)}/${TOTAL} ${phase.beat.padEnd(15)} ` +
          `live ${String(row.live).padStart(3)} ent ${String(row.entities).padStart(3)} ` +
          `prompt ${String(row.promptFacts).padStart(2)} sum ${String(row.summaryLen).padStart(4)}c ` +
          `V${(row.mood?.valence ?? 0).toFixed(2)} ${s}` +
          (row.assistantTells.length ? "  DRIFT" : "") + (row.extractOk ? "" : "  EXTRACT-FAIL")
        );
      }

      // ── Checkpoint every turn so the run is never lost ─────────────────────
      writeTranscript(transcriptFile, history, timeline, probes, { TOTAL, MODEL });
      fs.writeFileSync(resultsFile, JSON.stringify({
        at: new Date().toISOString(), model: MODEL, turns: TOTAL, completed: turn,
        usage, timeline, probes,
      }, null, 2));
    }
  } finally {
    db.close(); proc.kill();
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const first = timeline[0], last = timeline[timeline.length - 1];
  const cost = (usage.inTok * 0.20 + usage.outTok * 0.80) / 1e6;
  console.log("\n" + "═".repeat(76));
  console.log("RELATIONSHIP SOAK SUMMARY");
  console.log("═".repeat(76));
  console.log(`  exchanges completed  ${timeline.length}/${TOTAL}`);
  console.log(`  graph                ${last?.entities} entities · ${last?.live} live facts (${last?.facts} total)`);
  console.log(`  prompt window        ${last?.promptFacts} facts injected`);
  console.log(`  narrative summary    ${first?.summaryLen}c → ${last?.summaryLen}c`);
  console.log(`  persona length       ${first?.personaLen}c → ${last?.personaLen}c`);
  console.log(`  final stats          ${JSON.stringify(last?.stats)}`);
  console.log(`  final mood           ${JSON.stringify(last?.mood)}`);
  console.log(`  persona-drift turns  ${timeline.filter((t) => t.assistantTells.length).length}`);
  console.log(`  extraction failures  ${timeline.filter((t) => !t.extractOk).length}`);
  console.log(`  id remaps            ${timeline.reduce((n, t) => n + t.remapped, 0)}`);
  console.log(`  tokens               ${usage.inTok} in / ${usage.outTok} out over ${usage.calls} calls`);
  console.log(`  est. cost            $${cost.toFixed(3)}`);
  console.log(`\n  transcript  ${path.relative(APP_ROOT, transcriptFile)}`);
  console.log(`  metrics     ${path.relative(APP_ROOT, resultsFile)}\n`);
}

// ─── Transcript ───────────────────────────────────────────────────────────────

function writeTranscript(file, history, timeline, probes, meta) {
  const lines = [
    `# ${CHARACTER_NAME} & ${PERSONA_NAME} — long-run roleplay transcript`,
    "",
    `Generated by \`tests/memory-eval/long-chat.mjs\` against the real FableChat memory pipeline.`,
    `Model: \`${meta.MODEL}\` · target ${meta.TOTAL} exchanges · ${timeline.length} completed.`,
    "",
    `The character received the full conversation history plus its Core Memory block and`,
    `retrieved facts. After every exchange the transcript was run through Drawer 2`,
    `extraction and the Drawer 1 rewrite, exactly as the app does.`,
    "",
    "---",
    "",
  ];

  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    const userMsg = history[i * 2];
    const charMsg = history[i * 2 + 1];
    if (!userMsg || !charMsg) break;
    if (i === 0 || timeline[i - 1].beat !== t.beat) {
      lines.push(`## ${t.beat}`, "");
    }
    lines.push(`**${PERSONA_NAME}:** ${userMsg.content}`, "");
    lines.push(`**${CHARACTER_NAME}:** ${charMsg.content}`, "");
    const s = t.stats ?? {};
    lines.push(
      `<sub>turn ${t.turn} · live facts ${t.live} · injected ${t.promptFacts} · ` +
      `mood V${(t.mood?.valence ?? 0).toFixed(2)} A${(t.mood?.arousal ?? 0).toFixed(2)} D${(t.mood?.dominance ?? 0).toFixed(2)} · ` +
      `trust ${s.trust ?? "–"} affection ${s.affection ?? "–"} connection ${s.connection ?? "–"}</sub>`,
      ""
    );
    const probe = probes.find((p) => p.turn === t.turn);
    if (probe) {
      lines.push(
        `> **Memory probe.** The same question answered with memory only, no conversation history:`,
        ">",
        ...probe.memoryOnly.split("\n").map((l) => `> ${l}`),
        ""
      );
    }
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); });
