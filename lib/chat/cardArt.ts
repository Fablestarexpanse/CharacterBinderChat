// ─── Drawing a character's card art ───────────────────────────────────────────
// Export as a card → Generate art: ComfyUI draws the card face from the options
// picked (lib/cards/cardArt.ts). MOSS letters the name into the picture; your
// picture settings draw them most like themselves (LoRA, references, likeness)
// and the name is laid over afterwards (lib/cards/tradingCard.ts). The art is
// kept as an asset on the character (`cardFace`), so the card can be exported
// again without drawing it again.

import { useFableStore } from "@/lib/store";
import { renderTemplate } from "@/lib/prompts/render";
import { clientPromptTemplate } from "@/lib/chat/promptOverrides";
import { queueImage } from "@/lib/chat/imageGen";
import { waitForJob } from "@/lib/chat/photos";
import { workflowsForLikeness } from "@/lib/chat/workflowNodes";
import { storePicture } from "@/lib/chat/assets";
import { COMIC_WORKFLOW, lookOf } from "@/lib/chat/comic";
import { settingsForPerson } from "@/lib/media/imageLook";
import { COMIC_NEGATIVE, compileLayout, lookFromDescription } from "@/lib/media/comicPage";
import {
  CARD_ART_SIZE, cardArtVariables, cardMossLayout, cardMossVariables, shortTagline, tidyPrompt, type CardArtOptions,
} from "@/lib/cards/cardArt";
import { cardTagline } from "@/lib/cards/tradingCard";
import type { Character } from "@/lib/types";

/** Draw the art, keep it as an asset, and return its URL; throws with a reason the dialog can show. */
export async function generateCardArt(character: Character, options: CardArtOptions): Promise<string> {
  const st = useFableStore.getState();
  let settings;
  if (options.engine === "moss") {
    const person = { name: character.name, look: lookOf(character), tagline: shortTagline(cardTagline(character)) };
    const caption = tidyPrompt(renderTemplate(await clientPromptTemplate("image.card-moss"), cardMossVariables(options, person)));
    const lora = character.image?.comicLora;
    settings = {
      ...st.imageSettings, workflow: COMIC_WORKFLOW, prompt: compileLayout(cardMossLayout(options, person, caption)),
      negativePrompt: COMIC_NEGATIVE, ...CARD_ART_SIZE.moss, aspectRatio: "custom" as const, batchCount: 1,
      loras: lora?.name ? [{ name: lora.name, weight: lora.weight ?? 1 }] : [], referenceImages: undefined,
    };
  } else {
    let prompt = tidyPrompt(renderTemplate(await clientPromptTemplate("image.card-art"), cardArtVariables(options)));
    // No tags to lead with: their look in words, so the picture is of them
    if (!character.image?.tags?.trim()) prompt = tidyPrompt(`${lookFromDescription(character.description)}, ${prompt}`);
    const workflows = character.image?.likeness ? await workflowsForLikeness() : [];
    const look = character.image ? { ...character.image, undressedTags: undefined } : undefined;
    settings = settingsForPerson(
      { ...st.imageSettings, prompt, ...CARD_ART_SIZE.look, aspectRatio: "custom", batchCount: 1,
        negativePrompt: tidyPrompt(`${st.imageSettings.negativePrompt ?? ""}, text, letters, words, watermark, logo`) },
      { ...character, image: look }, workflows);
  }
  const job = queueImage(settings);
  const done = await waitForJob(job.id);
  if (done.status === "failed" || done.outputUrls.length === 0) {
    throw new Error(done.error ?? "No picture came back. Is ComfyUI running? (Settings → Media)");
  }
  return storePicture(done.outputUrls[0]);
}
