// ─── Minimal ZIP reader ───────────────────────────────────────────────────────
// Just enough to open a CharacterBinder archive (cards/*.png, cards/*.json and a
// manifest.json): stored and deflate entries, read through the central directory.
// Uses the platform's DecompressionStream, so it adds no dependency.
//
// Not a general unzip. No zip64, no encryption, no multi-disk. And because it
// reads untrusted files: entry count and sizes are capped (a "zip bomb" is a few
// KB that inflates to gigabytes), and names are only ever labels — nothing here
// writes to a path.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export const MAX_ENTRIES = 5000;
/** Largest single entry once inflated. Card art is megabytes, never tens. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** Total across the archive. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}

/** Inflate raw deflate data, refusing to produce more than `limit` bytes. */
async function inflateRaw(compressed: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("an entry is larger than the allowed size");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  if (!isZip(bytes)) throw new Error("not a ZIP file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End-of-central-directory record: scan back over the optional comment
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("not a valid ZIP (no end record)");

  const count = u16(view, eocd + 10);
  let cd = u32(view, eocd + 16);
  if (count === 0xffff || cd === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  if (count > MAX_ENTRIES) throw new Error(`archive has ${count} entries; the limit is ${MAX_ENTRIES}`);

  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (cd + 46 > bytes.length || u32(view, cd) !== 0x02014b50) throw new Error("ZIP central directory is damaged");
    const method = u16(view, cd + 10);
    const compressedSize = u32(view, cd + 20);
    const size = u32(view, cd + 24);
    const nameLen = u16(view, cd + 28);
    const extraLen = u16(view, cd + 30);
    const commentLen = u16(view, cd + 32);
    const local = u32(view, cd + 42);
    const name = new TextDecoder().decode(bytes.subarray(cd + 46, cd + 46 + nameLen));
    cd += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;                         // directory
    if (size > MAX_ENTRY_BYTES) throw new Error(`"${name}" is larger than the allowed size`);

    if (local + 30 > bytes.length || u32(view, local) !== 0x04034b50) throw new Error(`"${name}": damaged local header`);
    const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    if (start + compressedSize > bytes.length) throw new Error(`"${name}": data runs past the end of the file`);
    const raw = bytes.subarray(start, start + compressedSize);

    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw, MAX_ENTRY_BYTES);
    else throw new Error(`"${name}": unsupported compression method ${method}`);
    // The total counts what was actually produced, not the size the header
    // declared: a bomb's header can say anything.
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("archive is larger than the allowed total size");
    entries.push({ name, data });
  }
  return entries;
}
