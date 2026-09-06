// ─── Image jobs and the Image Studio's settings. ────────────────────────────────
// Image jobs and the Image Studio's settings.

import type { StateCreator } from "zustand";
import { defaultImageSettings } from "../defaults";
import type { FableStore } from "../index";
import type {
  ImageJob, ImageGenerationSettings,
} from "@/lib/types";

export interface MediaSlice {
  // Image Jobs
  imageJobs: ImageJob[];
  addImageJob: (job: ImageJob) => void;
  updateImageJob: (id: string, updates: Partial<ImageJob>) => void;
  /**
   * Delete renders and the image cards that referenced them. Dropping the job
   * alone would leave a card in the chat with nothing behind it, so the two
   * always go together. Conversation text is never touched — image cards carry
   * no dialogue, only the prompt.
   */
  deleteRenders: (jobIds: string[]) => void;

  // Image Settings (Image Studio panel)
  imageSettings: ImageGenerationSettings;
  setImageSettings: (s: Partial<ImageGenerationSettings>) => void;
}

export const createMediaSlice: StateCreator<FableStore, [], [], MediaSlice> = (set) => ({
  imageJobs: [],
  addImageJob: (job) => set((s) => ({ imageJobs: [job, ...s.imageJobs] })),
  updateImageJob: (id, updates) =>
    set((s) => ({ imageJobs: s.imageJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)) })),

  deleteRenders: (jobIds) => {
    const doomed = new Set(jobIds);
    if (doomed.size === 0) return;
    set((s) => ({
      imageJobs: s.imageJobs.filter((j) => !doomed.has(j.id)),
      chats: s.chats.map((c) => {
        const kept = c.messages.filter((m) => !m.imageJobId || !doomed.has(m.imageJobId));
        return kept.length === c.messages.length ? c : { ...c, messages: kept };
      }),
    }));
  },

  imageSettings: defaultImageSettings,
  setImageSettings: (s) =>
    set((state) => ({ imageSettings: { ...state.imageSettings, ...s } })),
});
