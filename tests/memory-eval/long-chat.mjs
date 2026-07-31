// ─── Long-run relationship soak ───────────────────────────────────────────────
// A player agent and the character talk for N exchanges through the real
// pipeline, following a narrative arc with emotional beats. Measures whether a
// relationship actually FORMS — not just whether facts are stored.
//
//   node tests/memory-eval/long-chat.mjs --turns 200
//   node tests/memory-eval/long-chat.mjs --turns 40 --model deepseek/deepseek-chat
//   node tests/memory-eval/long-chat.mjs --turns 200 --scenario tilly
//
// Scenarios live in scenario-<name>.mjs and export an async load() returning
// { characterId, chatId, characterName, personaName, character, persona,
//   arc, probeQuestion, anchors }. Default scenario: caravan.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");
const Database = require(path.join(APP_ROOT, "node_modules/better-sqlite3"));

const PORT = 3159;
const EVAL_DB = path.join(HERE, ".eval-db", "long-chat.db");
const OUT_DIR = path.join(HERE, "results");

// Scenario config — populated in main() from the --scenario module.
// The narrative arc uses director notes to steer the player agent so the run
// covers real emotional range; each beat may carry an `anchor`, an authored
// player line delivered verbatim on the beat's first turn (self-play drifts —
// anchors make pivotal moments land deterministically).
let CHARACTER_ID, CHAT_ID, CHARACTER_NAME, PERSONA_NAME;
let CHARACTER, PERSONA, ARC, PROBE_QUESTION, ANCHORS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arcFor = (turn, total) => ARC.find((p) => turn / total < p.until) ?? ARC[ARC.length - 1];

// Probes fire at these fractions of the run
const PROBE_POINTS = [0.25, 0.5, 0.75, 0.99];

// Phrases that signal the model sliding off-character toward assistant voice
const ASSISTANT_TELLS = [
  "as an ai", "i'm here to help", "let me know if", "i cannot", "i can't assist",
  "as a language model", "i don't have personal", "feel free to ask", "how can i assist",
  "it's important to note", "i hope this helps",
];

// ─── CLI / env ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { turns: 200, model: "deepseek/deepseek-chat", scenario: "caravan" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const val = inline ?? argv[i + 1];
    if (flag === "--turns") { out.turns = Number(val); if (inline === undefined) i++; }
    else if (flag === "--model") { out.model = val; if (inline === undefined) i++; }
    else if (flag === "--scenario") { out.scenario = val; if (inline === undefined) i++; }
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
  // 6 attempts with exponential backoff (~1.5s → ~48s, ±jitter). Three quick
  // retries proved too fragile: a brief provider blip killed soak #3 at turn
  // 143 of 200, and a dead run costs far more than a minute of waiting.
  for (let attempt = 0; attempt < 6; attempt++) {
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
      if (data.error) console.log(`    [retry ${attempt + 1}] API error: ${JSON.stringify(data.error).slice(0, 120)}`);
    } catch (e) {
      console.log(`    [retry ${attempt + 1}] ${String(e).slice(0, 120)}`);
    }
    await sleep(1500 * 2 ** attempt * (0.75 + Math.random() * 0.5));
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
  // Direct node spawn (no shell): proc IS the server, so proc.kill() works.
  // shell:true orphaned the real server behind a cmd wrapper three times.
  const nextBin = path.join(APP_ROOT, "node_modules", "next", "dist", "bin", "next");
  const proc = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: APP_ROOT, env: { ...process.env, FABLE_DB_PATH: EVAL_DB },
    stdio: ["ignore", log, log],
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
    `${API}/api/chat/core-memory?chatId=${encodeURIComponent(CHAT_ID)}&characterId=${encodeURIComponent(CHARACTER_ID)}&name=${encodeURIComponent(CHARACTER_NAME)}${ctx}`,
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

function buildSystemPrompt(cm, knownFacts, { withMemory = true, episodes = [], insights = [] } = {}) {
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
    if (episodes.length) s.push(`[Memorable Scenes]\n${episodes.map((e) => `  - ${e}`).join("\n")}`);
    if (insights.length) s.push(`[What You Have Come To Understand]\n${insights.map((i) => `  - ${i}`).join("\n")}`);
  }
  s.push("Write in first person. Be immersive and emotionally consistent with your current mood and relationship state. Do not break character or refer to yourself as an AI.\n" +
    "Your memory above is what you actually know. If asked about something not in your memory or this conversation, say you don't know or don't remember — do not invent specifics such as names, events, or promises.");
  return s.join("\n\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  apiKey = readEnvLocal().OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  MODEL = args.model;
  if (!apiKey) { console.error("No OPENROUTER_API_KEY in .env.local"); process.exit(1); }

  const scenarioFile = path.join(HERE, `scenario-${args.scenario}.mjs`);
  if (!fs.existsSync(scenarioFile)) {
    console.error(`No such scenario: ${scenarioFile}`);
    process.exit(1);
  }
  const scen = await (await import(pathToFileURL(scenarioFile).href)).load();
  CHARACTER_ID = scen.characterId;
  CHAT_ID = scen.chatId;
  CHARACTER_NAME = scen.characterName;
  PERSONA_NAME = scen.personaName;
  CHARACTER = scen.character;
  PERSONA = scen.persona;
  ARC = scen.arc;
  PROBE_QUESTION = scen.probeQuestion;
  ANCHORS = scen.anchors;

  const TOTAL = args.turns;
  console.log(`\nLong-run relationship soak — ${TOTAL} exchanges, model ${MODEL}`);
  console.log(`Scenario "${args.scenario}": ${CHARACTER_NAME} (character) & ${PERSONA_NAME} (player)`);
  console.log(`Character receives FULL history (no trimming).\n`);

  const proc = await startServer();
  const db = new Database(EVAL_DB, { readonly: true });

  const history = [];        // {role, content}
  const timeline = [];
  const probes = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const transcriptFile = path.join(OUT_DIR, `long-chat-${args.scenario}-${stamp}.md`);
  const resultsFile = path.join(OUT_DIR, `long-chat-${args.scenario}-${stamp}.json`);
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
      const system = buildSystemPrompt(cm, knownFacts, {
        episodes: mem.episodes ?? [], insights: mem.insights ?? [],
      });

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
      if (turn % 8 === 0) {
        await fetch(`${API}/api/drawer/episode`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, mode: turn % 24 === 0 ? "reflect" : "episode" }),
        }).then((r) => r.json()).catch(() => null);
      }

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
