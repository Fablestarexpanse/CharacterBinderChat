// ─── Generating a portrait ────────────────────────────────────────────────────
// The Generate button next to a portrait upload: one picture from the editable
// image.portrait prompt, with the look being edited (tags, LoRA, seed, likeness)
// applied the same way every picture of them is (settingsForPerson). The
// result is stored as an asset (storePicture) so the portrait is a reference,
// never the ComfyUI URL, and the job shows in Image Studio like any other.

import { useFableStore } from "@/lib/store";
import { renderTemplate } from "@/lib/prompts/render";
import { clientPromptTemplate } from "@/lib/chat/promptOverrides";
import { queueImage } from "@/lib/chat/imageGen";
import { waitForJob } from "@/lib/chat/photos";
import { workflowsForLikeness } from "@/lib/chat/workflowNodes";
import { storePicture } from "@/lib/chat/assets";
import { settingsForPerson, type ImageLook } from "@/lib/media/imageLook";

export interface PortraitSubject { name: string; image?: ImageLook; avatar?: string; referenceImages?: string[] }

/** Make a portrait of `who` and return its asset URL; throws with a reason the editor can show. */
export async function generatePortrait(who: PortraitSubject): Promise<string> {
  if (!who.image?.tags?.trim() && !who.image?.lora) {
    throw new Error("Add image tags first (or use Fill from description): they are what the portrait is drawn from.");
  }
  const st = useFableStore.getState();
  const prompt = renderTemplate(await clientPromptTemplate("image.portrait"), {});
  const workflows = who.image?.likeness ? await workflowsForLikeness() : [];
  // Always the usual tags: a portrait is never an undressed picture
  const look = who.image ? { ...who.image, undressedTags: undefined } : undefined;
  const settings = settingsForPerson({ ...st.imageSettings, prompt, batchCount: 1 }, { ...who, image: look }, workflows);
  const job = queueImage(settings);
  const done = await waitForJob(job.id);
  if (done.status === "failed" || done.outputUrls.length === 0) {
    throw new Error(done.error ?? "No picture came back. Is ComfyUI running? (Settings → Media)");
  }
  return storePicture(done.outputUrls[0]);
}
