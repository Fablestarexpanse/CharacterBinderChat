// ─── Long-run relationship soak ───────────────────────────────────────────────
// A player agent and the character talk for N exchanges through the real
// pipeline, following a narrative arc with emotional beats. Measures whether a
// relationship actually FORMS — not just whether facts are stored.
//
//   node tests/memory-eval/long-chat.mjs --turns 200
//   node tests/memory-eval/long-chat.mjs --turns 40 --model deepseek/deepseek-chat
//   node tests/memory-eval/long-chat.mjs --turns 200 --scenario tilly
//   node tests/memory-eval/long-chat.mjs --turns 100 --scenario tilly --live
//
// Scenarios live in scenario-<name>.mjs and export an async load() returning
// { characterId, chatId, characterName, personaName, character, persona,
//   arc, probeQuestion, anchors }. Default scenario: caravan.
//
// --live runs against the REAL app (port 3000, main database) instead of an
// isolated eval server, and mirrors the conversation into the app's durable
// chat state as it goes — afterwards the run is an ordinary chat you can open
// in FableChat: full history, Memory tab, Core Mem, the Web mind map, all of
// it. Keep the FableChat browser tab closed while a live run is going (an
// open tab's state sync could clobber the chat being written).
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

// Node strips the types; promptBuilder.ts has no runtime imports of its own.
const { buildSystemPrompt } = await import(
  pathToFileURL(path.join(APP_ROOT, "lib/chat/promptBuilder.ts")).href
);
const Database = require("better-sqlite3");

let PORT = 3159; // --live switches to the real app on :3000
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
  const out = { turns: 200, model: "deepseek/deepseek-chat", scenario: "caravan", live: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const val = inline ?? argv[i + 1];
    if (flag === "--turns") { out.turns = Number(val); if (inline === undefined) i++; }
    else if (flag === "--model") { out.model = val; if (inline === undefined) i++; }
    else if (flag === "--scenario") { out.scenario = val; if (inline === undefined) i++; }
    else if (flag === "--live") { out.live = true; }
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

const API = () => `http://127.0.0.1:${PORT}`;

// ─── Live mode: mirror the conversation into the app's durable chat state ────
// Makes the soak an ordinary FableChat chat: GET the current app state, upsert
// our chat (messages included), PUT it back. Runs every few turns so a stopped
// run is still browsable.

async function syncChatToApp(history, meta) {
  try {
    const state = await fetch(`${API()}/api/state`, { cache: "no-store" }).then((r) => r.json());
    const nowIso = new Date().toISOString();
    const base = Date.now() - history.length * 60_000; // spread timestamps ~1min apart
    const messages = history.map((m, i) => ({
      id:        `msg-${meta.chatId}-${i}`,
      chatId:    meta.chatId,
      role:      m.role,
      content:   m.content,
      ...(m.role === "assistant" ? { characterId: meta.characterId } : {}),
      timestamp: new Date(base + i * 60_000).toISOString(),
    }));
    const chat = {
      id:          meta.chatId,
      name:        meta.name,
      characterId: meta.characterId,
      modelId:     meta.modelId,
      providerId:  "openrouter",
      messages,
      createdAt:   meta.createdAt,
      updatedAt:   nowIso,
    };
    const chats = Array.isArray(state.chats) ? state.chats : [];
    const idx = chats.findIndex((c) => c.id === meta.chatId);
    if (idx === -1) chats.unshift(chat);
    else chats[idx] = chat;
    const res = await fetch(`${API()}/api/state`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characters: state.characters ?? [], chats,
        personas: state.personas ?? [], lorebooks: state.lorebooks ?? [],
      }),
    });
    if (!res.ok) console.log(`    [live-sync] rejected: ${(await res.text()).slice(0, 120)}`);
  } catch (e) {
    console.log(`    [live-sync] failed: ${String(e).slice(0, 120)}`);
  }
}

async function fetchMemory(context = "") {
  const ctx = context ? `&context=${encodeURIComponent(context.slice(0, 600))}` : "";
  return fetch(
    `${API()}/api/chat/core-memory?chatId=${encodeURIComponent(CHAT_ID)}&characterId=${encodeURIComponent(CHARACTER_ID)}&name=${encodeURIComponent(CHARACTER_NAME)}${ctx}`,
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

// The real builder, imported rather than mirrored: the suite exists to
// validate the prompt the app sends, and a copy validates the copy. It has no
// runtime imports beyond types, so Node's type stripping loads the .ts
// directly.
//
// The harness passes no preset, so [Global Instructions], [Preset
// Instructions] and the forbidden-words line stay absent — a non-empty global
// prompt puts a run off this measured baseline.
function systemPrompt(cm, knownFacts, { withMemory = true, episodes = [], insights = [], bits = [] } = {}) {
  return buildSystemPrompt({
    character:  CHARACTER,
    persona:    PERSONA,
    coreMemory: withMemory ? cm : null,
    knownFacts: withMemory ? knownFacts : [],
    episodes:   withMemory ? episodes : [],
    insights:   withMemory ? insights : [],
    bits:       withMemory ? bits : [],
  });
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

  // ── Live mode: real app, real database, browsable chat afterwards ─────────
  let liveMeta = null;
  if (args.live) {
    PORT = 3000;
    CHAT_ID = `chat-soak-${Date.now()}`;
    liveMeta = {
      chatId:      CHAT_ID,
      characterId: CHARACTER_ID,
      name:        `${CHARACTER_NAME} & ${PERSONA_NAME} — soak`,
      modelId:     MODEL,
      createdAt:   new Date().toISOString(),
    };
  }

  const TOTAL = args.turns;
  console.log(`\nLong-run relationship soak — ${TOTAL} exchanges, model ${MODEL}${args.live ? " · LIVE (main app)" : ""}`);
  console.log(`Scenario "${args.scenario}": ${CHARACTER_NAME} (character) & ${PERSONA_NAME} (player)`);
  console.log(`Character receives FULL history (no trimming).\n`);

  let proc = null;
  let dbPath = EVAL_DB;
  if (args.live) {
    // The real dev server must already be running; never spawn or wipe here.
    try {
      const r = await fetch(`${API()}/api/state`);
      if (!r.ok) throw new Error(`app server on :${PORT} answered ${r.status}`);
    } catch (e) {
      console.error(`--live needs the app running on :${PORT} (npm run dev). ${e}`);
      process.exit(1);
    }
    dbPath = path.join(APP_ROOT, "data", "fablestore.db");
    console.log(`  using live app on :${PORT} · chat "${liveMeta.name}" (${CHAT_ID})`);
  } else {
    proc = await startServer();
  }
  const db = new Database(dbPath, { readonly: true });

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
      const system = systemPrompt(cm, knownFacts, {
        episodes: mem.episodes ?? [], insights: mem.insights ?? [], bits: mem.bits ?? [],
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
        // Persona-drift anchor for the Drawer 1 rewrite — the app always
        // sends this; omitting it made the soak measure a configuration the
        // app never runs.
        characterAnchor: [CHARACTER.description, CHARACTER.personality].filter(Boolean).join(" "),
        providerType: "openrouter", providerBaseUrl: "https://openrouter.ai/api",
        modelId: MODEL, apiKey,
      };
      const ex = await fetch(`${API()}/api/drawer/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json()).catch(() => ({ ok: false }));
      await fetch(`${API()}/api/chat/core-memory/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json()).catch(() => null);
      // App cadence: an episode every 8 exchanges AND a reflection at every
      // 24 — two calls, not one (the old ternary skipped the episode at 24).
      if (turn % 8 === 0) {
        await fetch(`${API()}/api/drawer/episode`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, mode: "episode" }),
        }).then((r) => r.json()).catch(() => null);
      }
      if (turn % 24 === 0) {
        await fetch(`${API()}/api/drawer/episode`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, mode: "reflect" }),
        }).then((r) => r.json()).catch(() => null);
      }

      // ── Metrics ────────────────────────────────────────────────────────────
      const after = await fetchMemory(recent);
      const acm = after.coreMemory ?? {};
      // Every query chat-scoped: in live mode this database holds every chat
      const stats = Object.fromEntries(
        db.prepare("SELECT stat_name, value FROM relationship_stats WHERE chat_id = ? AND observer_id = ? AND target_id = 'player'")
          .all(CHAT_ID, CHARACTER_ID).map((r) => [r.stat_name, Math.round(r.value * 10) / 10]));
      const liveRows = db.prepare(
        "SELECT subject_id, predicate, object_id, object_literal FROM facts WHERE chat_id = ? AND superseded_by IS NULL AND t_valid_end IS NULL").all(CHAT_ID);
      const graphBlob = liveRows.map((f) => `${f.subject_id} ${f.predicate} ${f.object_id ?? f.object_literal ?? ""}`).join(" | ");
      const promptBlob = (after.knownFacts ?? []).join(" | ");
      const lower = reply.toLowerCase();

      const row = {
        turn, beat: phase.beat, isProbe,
        facts: db.prepare("SELECT COUNT(*) n FROM facts WHERE chat_id = ?").get(CHAT_ID).n,
        live: liveRows.length,
        entities: db.prepare("SELECT COUNT(*) n FROM entities WHERE chat_id = ?").get(CHAT_ID).n,
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
        // Memory-only means the WHOLE memory layer — episodes, insights and
        // shared language included; facts alone understated it.
        const memOnly = await chat([
          { role: "system", content: systemPrompt(cm, knownFacts, {
            episodes: mem.episodes ?? [], insights: mem.insights ?? [], bits: mem.bits ?? [],
          }) },
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

      // Live mode: keep the app's durable chat in step so the conversation is
      // browsable in FableChat at any point, not just after the run
      if (liveMeta && (turn === 1 || turn % 5 === 0 || turn === TOTAL)) {
        await syncChatToApp(history, liveMeta);
      }
    }
  } finally {
    if (liveMeta && history.length > 0) await syncChatToApp(history, liveMeta);
    db.close();
    proc?.kill();
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
  console.log(`  est. cost            $${cost.toFixed(3)} (deepseek-chat rates — wrong for other models)`);
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
