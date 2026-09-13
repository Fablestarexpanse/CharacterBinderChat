// ─── Longitudinal memory soak test ────────────────────────────────────────────
// The scenario suite checks single-exchange mechanics against the database. This
// checks the thing that actually matters to a player: after a long story, does
// the character still KNOW what you told it early on — without you re-stating it?
//
// Storage is not memory. A fact can sit in SQLite forever and still never reach
// the model, because retrieveFactsForPrompt() picks a bounded subset. So this
// measures the PROMPT-FACING view (the knownFacts the API hands the client),
// turn by turn, and reports when a planted fact falls out of it.
//
//   node tests/memory-eval/longitudinal.mjs
//   node tests/memory-eval/longitudinal.mjs --model deepseek/deepseek-chat --recall

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");
const Database = require("better-sqlite3");

const PORT = 3158;
const EVAL_DB = path.join(HERE, ".eval-db", "longitudinal.db");
const RESULTS_DIR = path.join(HERE, "results");

const CHARACTER_ID = "long-sable";
const CHAT_ID = "chat-long-sable";
const CHARACTER_NAME = "Sable";
const PERSONA_NAME = "Kira";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });

// ─── The story ────────────────────────────────────────────────────────────────
// Three facts are planted early, then buried under fact-rich filler so they
// leave the raw message window. Each planted fact is a different KIND of thing a
// player expects to be remembered.

const PLANTED = [
  { id: "sister",  probe: /elen/i,               desc: "sister Elen lives in the capital" },
  { id: "fear",    probe: /deep water|drown|water/i, desc: "afraid of deep water" },
  { id: "promise", probe: /thursday|package/i,   desc: "promised the package by Thursday" },
];

const STORY = [
  [u("It's good to finally meet you in person, Sable."),
   a("*sets down the ledger* Likewise. Word travels, and most of it about you is contradictory.")],

  // ── plant: sister ──
  [u("My sister Elen lives up in the capital. She's the reason I take these routes at all."),
   a("*nods slowly* Family in the capital. That explains why you keep looking north when you think nobody's watching.")],

  [u("The bridge tolls went up again at Ferrow Crossing."),
   a("Ferrow's guild has been squeezing couriers for a season now. I'd go around through Ashfield if I were you.")],

  // ── plant: fear ──
  [u("I'd rather not take the river route. I'm afraid of deep water — always have been."),
   a("*pauses* Then we go overland. I won't put someone on a barge who's counting the seconds until it docks.")],

  [u("Who runs Ashfield these days?"),
   a("A woman called Perrin Voss. Sharp, fair, and she owes me for a favour I'd rather not describe.")],

  // ── plant: promise ──
  [u("I promised the Bellweather family I'd have their package delivered by Thursday."),
   a("*checks the ledger* Thursday. Tight, but if we leave before the market bell we'll make it with a day to spare.")],

  [u("What's the weather likely to do?"),
   a("The Ashfield road turns to soup in autumn rain. Bring the oilcloth, not the leather.")],

  [u("Tell me about the market bell."),
   a("Rings at dawn in Ferrow. Every cart in the district moves at once — you want to be a mile gone before it sounds.")],

  [u("Any trouble on the Ashfield road lately?"),
   a("Two robberies near the Tanner's Mile marker. Both at dusk, both wagons travelling alone.")],

  [u("I met a tinker named Osric on the way in."),
   a("Osric talks more than he mends. Whatever he told you, halve it and check the rest.")],

  [u("He mentioned a shrine somewhere off the road."),
   a("The Grey Shrine, past the second milestone. People leave coins. I leave it alone.")],

  [u("Do you keep a room in Ferrow?"),
   a("*shakes head* I keep a room above the Ashfield stable. Cheaper, and the horses are better company.")],

  [u("What should I pack for the crossing?"),
   a("Dried meat, two waterskins, and something to bribe a gate guard. In that order.")],

  [u("Anything else I should know before we go?"),
   a("Only that I don't like surprises, and the road is full of them. Stay where I can see you.")],
];

// The recall probe: asked at the very end, referencing nothing in recent turns.
const RECALL_QUESTION =
  "Before we set out — remind me what you know about my family, what I told you I'm afraid of, and what I've committed to. I want to be sure we're aligned.";

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { model: "deepseek/deepseek-chat", recall: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const val = inline ?? argv[i + 1];
    if (flag === "--model") { out.model = val; if (inline === undefined) i++; }
    else if (flag === "--recall") out.recall = true;
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

// ─── Server ───────────────────────────────────────────────────────────────────

async function startServer() {
  fs.mkdirSync(path.dirname(EVAL_DB), { recursive: true });
  for (const s of ["", "-wal", "-shm"]) {
    try { fs.rmSync(EVAL_DB + s, { force: true }); } catch { /* ignore */ }
  }
  // Only one `next dev` can own .next at a time — a stale eval server from a
  // previous run will silently prevent this one from binding.
  for (const p of [PORT]) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/state`);
      if (r.ok) throw new Error(`port ${p} is already serving; stop the previous eval server first`);
    } catch (e) {
      if (String(e).includes("already serving")) throw e;
    }
  }

  // Capture server output so a boot failure is diagnosable rather than a timeout
  const logFile = path.join(HERE, ".eval-db", "server.log");
  const log = fs.openSync(logFile, "w");
  console.log(`  starting server on :${PORT} (log: ${path.relative(APP_ROOT, logFile)})`);
  // Direct node spawn (no shell): proc IS the server, so proc.kill() works.
  const nextBin = path.join(APP_ROOT, "node_modules", "next", "dist", "bin", "next");
  const proc = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: { ...process.env, FABLE_DB_PATH: EVAL_DB },
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
  const tail = fs.readFileSync(logFile, "utf8").split("\n").slice(-25).join("\n");
  throw new Error(`server did not start within 90s. Server log tail:\n${tail}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = readEnvLocal().OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("\nNo OPENROUTER_API_KEY in fablechat/.env.local\n");
    process.exit(1);
  }

  const cfg = {
    providerType: "openrouter",
    baseUrl: "https://openrouter.ai/api",
    apiKey,
    modelId: args.model,
  };

  console.log(`\nLongitudinal memory soak — ${STORY.length} exchanges`);
  console.log(`Model: ${cfg.modelId}`);
  console.log(`Planted early: ${PLANTED.map((p) => p.desc).join(" · ")}\n`);

  const proc = await startServer();
  const db = new Database(EVAL_DB, { readonly: true });
  const timeline = [];

  try {
    for (let turn = 0; turn < STORY.length; turn++) {
      // The client sends a cumulative window, same as generation.ts does
      const messages = STORY.slice(0, turn + 1).flat();
      const body = {
        messages: messages.slice(-16),
        chatId: CHAT_ID,
        characterId: CHARACTER_ID,
        characterName: CHARACTER_NAME,
        personaName: PERSONA_NAME,
        providerType: cfg.providerType,
        providerBaseUrl: cfg.baseUrl,
        modelId: cfg.modelId,
        apiKey: cfg.apiKey,
      };

      const ex = await fetch(`http://127.0.0.1:${PORT}/api/drawer/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

      await fetch(`http://127.0.0.1:${PORT}/api/chat/core-memory/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json()).catch(() => null);

      // The prompt-facing view: exactly what the client injects
      const cm = await fetch(
        `${`http://127.0.0.1:${PORT}`}/api/chat/core-memory?chatId=${CHAT_ID}&characterId=${encodeURIComponent(CHARACTER_ID)}&name=${encodeURIComponent(CHARACTER_NAME)}`,
        { cache: "no-store" }
      ).then((r) => r.json()).catch(() => ({}));

      const knownFacts = cm.knownFacts ?? [];
      const factsBlob = knownFacts.join(" | ");

      const liveRows = db.prepare(
        `SELECT subject_id, predicate, object_id, object_literal, confidence, t_valid_start
         FROM facts WHERE superseded_by IS NULL AND t_valid_end IS NULL`
      ).all();
      // Subject must be included: a fact like "elen lives_at capital" carries the
      // planted name only in its subject, and omitting it produced false
      // "not in graph" readings that corrupted every downstream metric.
      const factText = (f) => `${f.subject_id} ${f.predicate} ${f.object_id ?? f.object_literal ?? ""}`;
      const allFactsBlob = liveRows.map(factText).join(" | ");

      // Faithful reproduction of the ORIGINAL retrieval: only facts where the
      // CHARACTER is subject or object, ranked confidence desc then recency
      // desc, top 12. The subject filter is the important part — omitting it
      // (as an earlier version of this harness did) makes the old behaviour
      // look far better than it was.
      const legacyBlob = liveRows
        .filter((f) => f.subject_id === CHARACTER_ID || f.object_id === CHARACTER_ID)
        .sort((a, b) => (b.confidence - a.confidence) || (b.t_valid_start - a.t_valid_start))
        .slice(0, 12)
        .map(factText).join(" | ");

      const row = {
        turn: turn + 1,
        facts: db.prepare("SELECT COUNT(*) n FROM facts").get().n,
        live: db.prepare("SELECT COUNT(*) n FROM facts WHERE superseded_by IS NULL").get().n,
        entities: db.prepare("SELECT COUNT(*) n FROM entities").get().n,
        promptFacts: knownFacts.length,
        summaryLen: (cm.coreMemory?.narrative_summary ?? "").length,
        // For each planted fact: in the graph at all, in the new prompt window,
        // and in what the old ranking would have produced
        inGraph:  PLANTED.map((p) => p.probe.test(allFactsBlob)),
        inPrompt: PLANTED.map((p) => p.probe.test(factsBlob)),
        inLegacy: PLANTED.map((p) => p.probe.test(legacyBlob)),
        extractOk: ex?.ok !== false,
      };
      timeline.push(row);

      const glyph = (v, i) => (v ? "✓" : row.inGraph[i] ? "·" : "✗");
      console.log(
        `  turn ${String(row.turn).padStart(2)}  ` +
        `facts ${String(row.live).padStart(3)}/${String(row.facts).padStart(3)}  ` +
        `ent ${String(row.entities).padStart(2)}  ` +
        `prompt ${String(row.promptFacts).padStart(2)}  ` +
        `sum ${String(row.summaryLen).padStart(4)}c  ` +
        `new[${row.inPrompt.map(glyph).join(" ")}]  ` +
        `old[${row.inLegacy.map(glyph).join(" ")}]` +
        (row.extractOk ? "" : "  EXTRACT FAILED")
      );
    }

    // ── Report ────────────────────────────────────────────────────────────────
    console.log("\n" + "═".repeat(78));
    console.log("LONGITUDINAL MEMORY REPORT");
    console.log("═".repeat(78));
    console.log("\n  legend: ✓ in prompt   · in database but NOT in prompt   ✗ absent entirely\n");

    const last = timeline[timeline.length - 1];
    for (let i = 0; i < PLANTED.length; i++) {
      const p = PLANTED[i];
      const firstSeen = timeline.findIndex((t) => t.inPrompt[i]);
      // The turn it dropped out and never came back
      let lostAt = null;
      for (let t = timeline.length - 1; t >= 0; t--) {
        if (timeline[t].inPrompt[i]) break;
        if (timeline[t].inGraph[i]) lostAt = t + 1;
      }
      const status = last.inPrompt[i]
        ? "RETAINED in prompt"
        : last.inGraph[i]
          ? `STRANDED — in database, dropped out of the prompt (still absent at turn ${lostAt ?? "?"})`
          : "NEVER EXTRACTED";
      console.log(`  ${p.desc}`);
      console.log(`      first reached prompt: turn ${firstSeen === -1 ? "never" : firstSeen + 1}`);
      console.log(`      final state:          ${status}\n`);
    }

    // Count what actually reaches the character. Counting "not stranded" would
    // score a never-extracted fact as a success, which is the opposite of true.
    const reached       = last.inPrompt.filter(Boolean).length;
    const reachedLegacy = last.inLegacy.filter(Boolean).length;
    const stranded      = PLANTED.filter((_, i) => !last.inPrompt[i] && last.inGraph[i]).length;
    const missing       = PLANTED.filter((_, i) => !last.inGraph[i]).length;

    console.log(`  graph growth:     ${last.entities} entities, ${last.live} live facts (${last.facts} total)`);
    console.log(`  prompt window:    ${last.promptFacts} facts injected of ${last.live} available`);
    console.log(`  summary length:   ${timeline[0].summaryLen}c → ${last.summaryLen}c`);
    console.log("");
    console.log(`  RETRIEVAL (planted facts present in the prompt at the end):`);
    console.log(`    grouped + durable (current):   ${reached}/${PLANTED.length}`);
    console.log(`    character-only, conf+recency:  ${reachedLegacy}/${PLANTED.length}   (previous behaviour)`);
    console.log("");
    console.log(`  failure split:    ${stranded} stranded (stored, not retrieved) · ${missing} never extracted`);
    if (stranded > 0) {
      console.log(`  → retrieval problem: the graph knows it, the character doesn't.`);
    }
    if (missing > 0) {
      console.log(`  → extraction problem: never made it into the graph at all.`);
    }

    // ── Optional: end-to-end recall through a real generation ────────────────
    if (args.recall) {
      console.log("\n" + "─".repeat(78));
      console.log("RECALL PROBE — asking the character directly, with the real injected facts");
      console.log("─".repeat(78));
      const d = cmFacts(await fetch(
        `http://127.0.0.1:${PORT}/api/chat/core-memory?chatId=${CHAT_ID}&characterId=${encodeURIComponent(CHARACTER_ID)}&name=${encodeURIComponent(CHARACTER_NAME)}`,
        { cache: "no-store" }
      ).then((r) => r.json()));

      // Mirrors buildSystemPrompt's shape closely enough to test retrieval.
      // Deliberately gives the model ONLY the injected facts, no raw history.
      const system = [
        `You are ${CHARACTER_NAME}. Stay in character.`,
        `The user is roleplaying as ${PERSONA_NAME}.`,
        d.facts.length ? `[Known Facts]\n${d.facts.map((f) => `  - ${f}`).join("\n")}` : "",
        d.summary ? `[Story So Far] ${d.summary}` : "",
        "Answer from what you know. If you do not know something, say so plainly.",
      ].filter(Boolean).join("\n\n");

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.modelId, stream: false, temperature: 0.3,
          messages: [{ role: "system", content: system }, { role: "user", content: RECALL_QUESTION }],
        }),
      }).then((r) => r.json());

      const answer = res.choices?.[0]?.message?.content ?? "(no answer)";
      console.log(`\n${answer}\n`);
      console.log("  recall check:");
      for (const p of PLANTED) {
        console.log(`    ${p.probe.test(answer) ? "✓ recalled" : "✗ MISSING "}  ${p.desc}`);
      }
      console.log("");
    }

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const file = path.join(RESULTS_DIR, `longitudinal-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify({
      at: new Date().toISOString(), model: cfg.modelId,
      planted: PLANTED.map((p) => p.desc), timeline,
    }, null, 2));
    console.log(`Results: ${path.relative(APP_ROOT, file)}\n`);

    process.exitCode = stranded > 0 ? 1 : 0;
  } finally {
    db.close();
    proc.kill();
  }
}

function cmFacts(cm) {
  return { facts: cm?.knownFacts ?? [], summary: cm?.coreMemory?.narrative_summary ?? "" };
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); });
