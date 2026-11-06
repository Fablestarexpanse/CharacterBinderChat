// ─── Testing a video connection with a real clip ──────────────────────────────
// Server-only. "Test" on a ComfyUI connection used for video makes an actual
// ~2-second clip instead of only checking ComfyUI answers: a generated test
// frame goes into the first-frame input of your video workflow (yours first,
// else the bundled MiniMax H3 one), the clip comes back and is shown in a
// player. A refused workflow names the model files ComfyUI lacks.

import zlib from "node:zlib";
import { MAX_VIDEO_BYTES, readBodyCapped, readJsonCapped } from "@/lib/server/assets";
import { listWorkflows, getWorkflow } from "@/lib/server/workflows";
import { injectReferences } from "@/lib/media/imageLook";
import { isReferenceWorkflow } from "@/lib/media/clipRefs";
import { missingFiles } from "@/lib/providers/comfyui";
import type { WorkflowMapping } from "@/lib/media/workflowDetect";
import type { WorkflowSummary } from "@/lib/api/dto";

/** The bundled first-frame workflow (workflows/h3-image-to-video.json) */
const BUNDLED = "h3-image-to-video";
/** ~2.3 s at 24 fps, on H3's 17k+5 frame grid: short, so the test is quick */
export const TEST_FRAMES = 56;
const TEST_MOTION = "The camera slowly pushes in while soft light drifts across the scene. Sound: a quiet room tone. No music, no text on screen.";
const POLL_MS = 2000;

export interface VideoTestResult { ok: boolean; label: string; sample?: { type: "video"; dataUrl: string } }

/** The workflow to test with: a first-frame one (yours, else the bundled one), else any video workflow that takes a picture. */
export function testWorkflow(workflows: WorkflowSummary[]): string | null {
  const ok = workflows.filter((w) => !w.error && w.purpose === "video" && w.controls.includes("referenceImage"));
  const frames = ok.filter((w) => !isReferenceWorkflow(w.classTypes));
  return (frames.find((w) => w.source === "imported") ?? frames.find((w) => w.slug === BUNDLED) ?? ok[0])?.slug ?? null;
}

/** A 512×512 PNG test frame: a soft gradient with a darker disc, so motion is visible. */
export function testFrame(size = 512): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = (c >>> 8) ^ crcTable[(c ^ x) & 0xff]; return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size * 0.55, y - size * 0.45) < size * 0.18;
      const i = row + 1 + x * 3;
      raw[i] = d ? 70 : 120 + Math.round((x / size) * 100);
      raw[i + 1] = d ? 60 : 110 + Math.round((y / size) * 80);
      raw[i + 2] = d ? 90 : 160;
    }
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

const setPath = (wf: Record<string, unknown>, p: string | null | undefined, value: unknown) => {
  if (!p) return;
  const [id, , key] = p.split(".");
  const node = wf[id] as { inputs?: Record<string, unknown> } | undefined;
  if (node?.inputs && key) node.inputs[key] = value;
};

export async function testVideoClip(baseUrl: string, opts: { timeoutMs?: number } = {}): Promise<VideoTestResult> {
  const slug = testWorkflow(await listWorkflows());
  if (!slug) return { ok: false, label: "ComfyUI answers, but there is no video workflow that takes a picture. Import one on the Workflows screen." };
  const wf = await getWorkflow(slug);
  if (!wf) return { ok: false, label: `The workflow "${slug}" could not be read.` };
  const mapping = ((wf._meta as { fablechat?: WorkflowMapping } | undefined)?.fablechat) ?? {};

  // The test frame goes in as the first picture; the workflow's other picture slots are left out
  await injectReferences(wf, mapping.referenceImageNodes, ["test"], async () => {
    const form = new FormData();
    form.append("image", new Blob([testFrame() as BlobPart], { type: "image/png" }), "fablechat-video-test.png");
    form.append("overwrite", "true");
    const res = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const j = (await readJsonCapped(res).catch(() => null)) as { name?: string; subfolder?: string } | null;
    if (!res.ok || !j?.name) throw new Error(`ComfyUI did not accept the test frame (HTTP ${res.status}).`);
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  });
  setPath(wf, mapping.promptNode, isReferenceWorkflow(Object.values(wf).map((n) => (n as { class_type?: string })?.class_type ?? ""))
    ? `<Picture 1> is the first frame of [Shot 1]. ${TEST_MOTION}` : TEST_MOTION);
  setPath(wf, mapping.videoLengthNode, TEST_FRAMES);
  setPath(wf, mapping.seedNode, Math.floor(Math.random() * 0xffffffff));
  const prompt = { ...wf };
  delete prompt._meta;

  const queued = await fetch(`${baseUrl}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "fablechat-video-test" }), signal: AbortSignal.timeout(30_000),
  });
  const qj = (await readJsonCapped(queued).catch(() => null)) as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown } | null;
  if (!queued.ok || !qj?.prompt_id) {
    const missing = missingFiles(qj?.node_errors);
    return {
      ok: false,
      label: missing.length
        ? `ComfyUI answers, but "${slug}" needs model files it does not have: ${missing.join(", ")}.`
        : `ComfyUI refused the video workflow "${slug}": ${qj?.error?.message ?? `HTTP ${queued.status}`}.`,
    };
  }

  const started = Date.now();
  const deadline = started + (opts.timeoutMs ?? 20 * 60 * 1000);
  while (Date.now() < deadline) {
    const h = await fetch(`${baseUrl}/history/${qj.prompt_id}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const entry = h?.ok ? (((await readJsonCapped(h)) ?? {}) as Record<string, { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }>; videos?: Array<{ filename: string; subfolder: string; type: string }> }> }>)[qj.prompt_id] : undefined;
    if (entry?.status?.status_str === "error") return { ok: false, label: `ComfyUI started the test clip with "${slug}" but it failed. The ComfyUI console says why.` };
    if (entry?.status?.completed) {
      const file = Object.values(entry.outputs ?? {}).flatMap((o) => [...(o.videos ?? []), ...(o.images ?? [])]).find((f) => f.type !== "temp" && /\.(mp4|webm|mov|mkv)$/i.test(f.filename));
      if (!file) return { ok: false, label: `"${slug}" finished but saved no clip (no Save Video output?).` };
      const view = await fetch(`${baseUrl}/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type })}`, { signal: AbortSignal.timeout(60_000) });
      if (!view.ok) return { ok: false, label: `The clip was made but could not be read back (HTTP ${view.status}).` };
      const bytes = Buffer.from(await readBodyCapped(view, MAX_VIDEO_BYTES, "the clip"));
      const mime = /\.webm$/i.test(file.filename) ? "video/webm" : "video/mp4";
      const secs = Math.round((Date.now() - started) / 1000);
      return { ok: true, label: `Made a ${(TEST_FRAMES / 24).toFixed(1)}-second test clip with "${slug}" in ${secs} s.`, sample: { type: "video", dataUrl: `data:${mime};base64,${bytes.toString("base64")}` } };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, label: `No clip after ${Math.round((Date.now() - started) / 60000)} minutes; it may still be running in ComfyUI.` };
}
