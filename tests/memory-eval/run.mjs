// ─── Memory eval harness ──────────────────────────────────────────────────────
// Drives scripted conversations through the REAL extraction + core-memory routes
// against an isolated database, then asserts on the resulting graph.
//
//   node tests/memory-eval/run.mjs                        # default cheap models
//   node tests/memory-eval/run.mjs --models a/b,c/d       # explicit models
//   node tests/memory-eval/run.mjs --only location-supersession
//   node tests/memory-eval/run.mjs --provider lmstudio --base http://127.0.0.1:9999
//
// The OpenRouter key is read from fablechat/.env.local (gitignored) — it is
// never passed on the command line or written to results.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { SCENARIOS } from "./scenarios.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");
const Database = require(path.join(APP_ROOT, "node_modules/better-sqlite3"));

const PORT = 3157;                                   // dedicated, avoids the dev server
const EVAL_DB = path.join(HERE, ".eval-db", "eval.db");
const RESULTS_DIR = path.join(HERE, "results");
const DEFAULT_MODELS = ["deepseek/deepseek-chat"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { models: null, only: null, provider: "openrouter", base: null, keepServer: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineVal] = argv[i].split("=");
    const val = inlineVal ?? argv[i + 1];
    const bump = () => { if (inlineVal === undefined) i++; };
    if (flag === "--models")        { out.models = val.split(",").map((s) => s.trim()).filter(Boolean); bump(); }
    else if (flag === "--only")     { out.only = val.split(",").map((s) => s.trim()).filter(Boolean); bump(); }
    else if (flag === "--provider") { out.provider = val; bump(); }
    else if (flag === "--base")     { out.base = val; bump(); }
    else if (flag === "--keep-server") { out.keepServer = true; }
  }
  return out;
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

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

// ─── Server lifecycle ─────────────────────────────────────────────────────────

async function startServer() {
  fs.mkdirSync(path.dirname(EVAL_DB), { recursive: true });
  // Fresh file per run so a stale schema can't mask a failure
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(EVAL_DB + suffix, { force: true }); } catch { /* ignore */ }
  }

  console.log(`  starting eval server on :${PORT} (db: ${path.relative(APP_ROOT, EVAL_DB)})`);
  const proc = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: { ...process.env, FABLE_DB_PATH: EVAL_DB },
    shell: true,
    stdio: "ignore",
  });

  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/state`);
      if (res.ok) { await res.json(); console.log(`  server ready after ${i + 1}s`); return proc; }
    } catch { /* still booting */ }
  }
  proc.kill();
  throw new Error("eval server did not become ready in 90s");
}

// ─── DB access ────────────────────────────────────────────────────────────────

function openDb() {
  return new Database(EVAL_DB);
}

function wipe(db) {
  for (const t of ["facts", "relationship_stats", "commitments", "memory_cards", "core_memory", "entities"]) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table may not exist yet */ }
  }
}

/** Query helper handed to scenario checks */
function queryApi(db) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    liveFacts: (subjectId) =>
      db.prepare("SELECT * FROM facts WHERE subject_id = ? AND superseded_by IS NULL AND (t_valid_end IS NULL) ORDER BY id").all(subjectId),
    allFacts: (subjectId) =>
      db.prepare("SELECT * FROM facts WHERE subject_id = ? ORDER BY id").all(subjectId),
    everyFact: () => db.prepare("SELECT * FROM facts ORDER BY id").all(),
    entities: () => db.prepare("SELECT * FROM entities ORDER BY id").all(),
    entity: (id) => db.prepare("SELECT * FROM entities WHERE id = ?").get(id) ?? null,
    stats: (observer, target) => {
      const rows = db.prepare("SELECT stat_name, value FROM relationship_stats WHERE observer_id = ? AND target_id = ?").all(observer, target);
      return Object.fromEntries(rows.map((r) => [r.stat_name, r.value]));
    },
    coreMemory: (characterId) => {
      const row = db.prepare("SELECT * FROM core_memory WHERE character_id = ?").get(characterId);
      return row ? { ...row, data: JSON.parse(row.data) } : null;
    },
    /** Entities whose normalized names collide — the duplicate-drift signal */
    duplicateClusters: () => {
      const groups = new Map();
      for (const e of db.prepare("SELECT id, name FROM entities").all()) {
        const key = norm(e.name);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e.id);
      }
      return [...groups.values()].filter((ids) => ids.length > 1);
    },
  };
}

// ─── Running one scenario ─────────────────────────────────────────────────────

async function runBatches(scenario, batches, model, cfg, metrics) {
  for (const messages of batches) {
    const body = {
      messages,
      characterId:     scenario.characterId,
      characterName:   scenario.characterName,
      personaName:     scenario.personaName,
      providerType:    cfg.providerType,
      providerBaseUrl: cfg.baseUrl,
      modelId:         model,
      apiKey:          cfg.apiKey,
    };
    const t0 = Date.now();
    let res, json;
    try {
      res = await fetch(`http://127.0.0.1:${PORT}/api/drawer/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      metrics.calls.push({ kind: "extract", ok: false, ms: Date.now() - t0, error: String(e) });
      continue;
    }
    const ok = res.ok && json?.ok !== false;
    metrics.calls.push({
      kind: "extract",
      ok,
      status: res.status,
      ms: Date.now() - t0,
      promptChars: JSON.stringify(messages).length,
      error: ok ? undefined : json?.error,
    });
    if (!ok) metrics.parseFailures++;
  }
}

async function runScenario(scenario, model, cfg, db) {
  wipe(db);
  const metrics = { calls: [], parseFailures: 0 };
  const ctx = { snapshots: [] };
  const q = queryApi(db);

  await runBatches(scenario, scenario.batches, model, cfg, metrics);

  // Some scenarios need an intermediate reading before a second act
  if (scenario.followUp) {
    ctx.snapshots.push({ stats: q.stats("player", scenario.characterId) });
    await runBatches(scenario, scenario.followUp.batches, model, cfg, metrics);
  }

  if (scenario.refreshCore) {
    const last = scenario.batches[scenario.batches.length - 1];
    const t0 = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chat/core-memory/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: scenario.characterId, characterName: scenario.characterName,
          personaName: scenario.personaName, recentMessages: last,
          providerType: cfg.providerType, providerBaseUrl: cfg.baseUrl,
          modelId: model, apiKey: cfg.apiKey,
        }),
      });
      const json = await res.json().catch(() => null);
      const ok = res.ok && json?.ok !== false;
      metrics.calls.push({ kind: "refresh", ok, status: res.status, ms: Date.now() - t0, error: ok ? undefined : json?.error });
      if (!ok) metrics.parseFailures++;
    } catch (e) {
      metrics.calls.push({ kind: "refresh", ok: false, ms: Date.now() - t0, error: String(e) });
    }
  }

  let checks;
  try {
    checks = scenario.check(q, ctx);
  } catch (e) {
    checks = [{ name: "check threw", pass: false, detail: String(e) }];
  }

  return {
    id: scenario.id,
    what: scenario.what,
    checks,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    calls: metrics.calls,
    parseFailures: metrics.parseFailures,
    // Graph shape after the run — useful even when checks pass
    graph: {
      entities: q.entities().length,
      facts: q.everyFact().length,
      liveFacts: q.everyFact().filter((f) => f.superseded_by === null).length,
      duplicateClusters: q.duplicateClusters().length,
    },
  };
}

// ─── Pricing (so a run can report what it actually cost) ─────────────────────

async function fetchPricing(apiKey) {
  if (!apiKey) return {};
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return Object.fromEntries(
      (data.data ?? []).map((m) => [m.id, {
        prompt: Number(m.pricing?.prompt ?? 0),
        completion: Number(m.pricing?.completion ?? 0),
      }])
    );
  } catch { return {}; }
}

// ─── Reporting ────────────────────────────────────────────────────────────────

const pct = (n, d) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

function report(runs, pricing) {
  console.log("\n" + "═".repeat(78));
  console.log("MEMORY EVAL RESULTS");
  console.log("═".repeat(78));

  for (const run of runs) {
    const allChecks = run.scenarios.flatMap((s) => s.checks);
    const passed = allChecks.filter((c) => c.pass).length;
    const calls = run.scenarios.flatMap((s) => s.calls);
    const okCalls = calls.filter((c) => c.ok);
    const latencies = okCalls.map((c) => c.ms).sort((a, b) => a - b);
    const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;

    console.log(`\n▸ ${run.model}`);
    console.log(`  checks passed      ${passed}/${allChecks.length}  (${pct(passed, allChecks.length)})`);
    console.log(`  JSON compliance    ${okCalls.length}/${calls.length}  (${pct(okCalls.length, calls.length)})`);
    console.log(`  median latency     ${median} ms`);

    const price = pricing[run.model];
    if (price) {
      // Rough: prompt chars/4 for input, assume ~250 output tokens per call
      const inTok = calls.reduce((n, c) => n + (c.promptChars ?? 2000) / 4 + 500, 0);
      const outTok = calls.length * 250;
      const cost = inTok * price.prompt + outTok * price.completion;
      console.log(`  est. cost          $${cost.toFixed(5)}`);
    }

    console.log("");
    for (const s of run.scenarios) {
      const mark = s.passed === s.total ? "PASS" : s.passed === 0 ? "FAIL" : "PART";
      console.log(`  [${mark}] ${s.id}  ${s.passed}/${s.total}`);
      for (const c of s.checks.filter((c) => !c.pass)) {
        console.log(`         ✗ ${c.name} — ${c.detail}`);
      }
      if (s.parseFailures > 0) {
        console.log(`         ! ${s.parseFailures} call(s) returned unusable output`);
      }
    }
  }

  console.log("\n" + "─".repeat(78));
  console.log("Signals worth acting on:");
  for (const run of runs) {
    const calls = run.scenarios.flatMap((s) => s.calls);
    const compliance = calls.filter((c) => c.ok).length / (calls.length || 1);
    if (compliance < 1) {
      console.log(`  • ${run.model}: ${pct(calls.length - calls.filter((c) => c.ok).length, calls.length)} of calls unusable — this model can't reliably drive extraction.`);
    }
    const dupes = run.scenarios.reduce((n, s) => n + s.graph.duplicateClusters, 0);
    if (dupes > 0) {
      console.log(`  • ${run.model}: ${dupes} duplicate entity cluster(s) — entity roster injection is not holding.`);
    }
    const failing = run.scenarios.filter((s) => s.passed < s.total).map((s) => s.id);
    if (failing.length) {
      console.log(`  • ${run.model}: failing scenarios → ${failing.join(", ")}`);
    }
  }
  console.log("─".repeat(78) + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnvLocal();
  const apiKey = env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;

  const cfg = {
    providerType: args.provider,
    baseUrl: args.base ?? (args.provider === "openrouter" ? "https://openrouter.ai/api" : "http://127.0.0.1:1234"),
    apiKey: args.provider === "openrouter" ? apiKey : undefined,
  };

  if (args.provider === "openrouter" && !apiKey) {
    console.error(
      "\nNo OpenRouter key found.\n" +
      "  Add this line to fablechat/.env.local (gitignored):\n" +
      "    OPENROUTER_API_KEY=sk-or-...\n" +
      "  Or run against a local provider:\n" +
      "    node tests/memory-eval/run.mjs --provider lmstudio --base http://127.0.0.1:1234 --models local-model\n"
    );
    process.exit(1);
  }

  const models = args.models ?? DEFAULT_MODELS;
  const scenarios = args.only ? SCENARIOS.filter((s) => args.only.includes(s.id)) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`No scenarios matched. Available: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`\nModels:    ${models.join(", ")}`);
  console.log(`Scenarios: ${scenarios.map((s) => s.id).join(", ")}`);
  console.log(`Provider:  ${cfg.providerType} @ ${cfg.baseUrl}`);

  const pricing = await fetchPricing(cfg.apiKey);
  const proc = await startServer();
  const db = openDb();
  const runs = [];

  try {
    for (const model of models) {
      console.log(`\n── ${model} ──`);
      const results = [];
      for (const scenario of scenarios) {
        process.stdout.write(`  ${scenario.id} … `);
        const r = await runScenario(scenario, model, cfg, db);
        results.push(r);
        console.log(`${r.passed}/${r.total}`);
      }
      runs.push({ model, scenarios: results });
    }
  } finally {
    db.close();
    if (!args.keepServer) proc.kill();
  }

  report(runs, pricing);

  // Persist for trend tracking across runs
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(RESULTS_DIR, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), provider: cfg.providerType, runs }, null, 2));
  console.log(`Results: ${path.relative(APP_ROOT, file)}\n`);

  const anyFail = runs.some((r) => r.scenarios.some((s) => s.passed < s.total));
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); });
