// Imported workflows: stored in the database, served like bundled ones, never
// clashing with or replacing a bundled template.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FABLE_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fable-wf-")), "t.db");
const W = await import("../../lib/server/workflows.ts");

const graph = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "x", clip: ["2", 0] } },
  "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "m.safetensors" } },
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 7, positive: ["1", 0], negative: ["1", 0], latent_image: ["4", 0] } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
};

test("an import is listed, served, and keeps its mapping; bundled ones still list", async () => {
  const r = await W.saveImported({ title: "My Portrait", workflow: graph, mapping: { purpose: "portrait", promptNode: "1.inputs.text", seedNode: "3.inputs.seed" } });
  assert.ok(r.ok);
  assert.equal(r.slug, "my-portrait");
  const list = await W.listWorkflows();
  const mine = list.find((w) => w.slug === "my-portrait");
  assert.equal(mine.source, "imported");
  assert.equal(mine.purpose, "portrait");
  assert.deepEqual(mine.controls.sort(), ["prompt", "seed"]);
  assert.ok(list.some((w) => w.source === "bundled" && w.slug === "sdxl-portrait"));
  const served = await W.getWorkflow("my-portrait");
  assert.equal(served._meta.fablechat.promptNode, "1.inputs.text");
  assert.equal(served["3"].class_type, "KSampler");
});

test("an import never takes a bundled name, and bundled templates cannot be changed or removed", async () => {
  const r = await W.saveImported({ title: "SDXL Portrait", workflow: graph, mapping: {} });
  assert.equal(r.slug, "sdxl-portrait-2");
  const bundledEdit = await W.saveImported({ slug: "sdxl-portrait", title: "x", workflow: graph, mapping: {} });
  assert.equal(bundledEdit.ok, false);
  assert.match(bundledEdit.error, /Bundled workflows cannot be changed/);
  assert.equal(W.deleteImported("sdxl-portrait"), false);
  assert.equal((await W.getWorkflow("sdxl-portrait"))._meta.title !== "x", true, "the bundled file is untouched");
});

test("updating keeps the slug; a bad path or purpose in a mapping is dropped; deletion removes it", async () => {
  const r = await W.saveImported({ slug: "my-portrait", title: "Renamed", workflow: graph, mapping: { promptNode: "1.inputs.text", seedNode: "../../etc", purpose: "evil", referenceImageNodes: ["5.inputs.image", 7] } });
  assert.ok(r.ok);
  const m = (await W.getWorkflow("my-portrait"))._meta;
  assert.equal(m.title, "Renamed");
  assert.equal(m.fablechat.seedNode, null);
  assert.equal(m.fablechat.purpose, undefined);
  assert.deepEqual(m.fablechat.referenceImageNodes, ["5.inputs.image"]);
  assert.equal(W.deleteImported("my-portrait"), true);
  assert.equal(await W.getWorkflow("my-portrait"), null);
});

test("a UI-format save is refused at import", async () => {
  const r = await W.saveImported({ title: "UI", workflow: { nodes: [], links: [] }, mapping: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /Export \(API\)/);
});
