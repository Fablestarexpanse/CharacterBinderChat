// ─── Image jobs and the Image Studio's settings. ────────────────────────────────

import type { StateCreator } from "zustand";
import { defaultImageSettings } from "../defaults";
import type { FableStore } from "../index";
import type {
  ImageJob, ImageGenerationSettings,
} from "@/lib/types";
import { removeRenders, restoreRenders, type RemovedRenders } from "@/lib/media/renders";

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
  deleteRenders: (jobIds: string[]) => RemovedRenders;
  /** Undo a deleteRenders: the renders and their image cards go back where they were. */
  restoreRenders: (removed: RemovedRenders) => void;

  // Image Settings (Image Studio panel)
  imageSettings: ImageGenerationSettings;
  setImageSettings: (s: Partial<ImageGenerationSettings>) => void;
}

export const createMediaSlice: StateCreator<FableStore, [], [], MediaSlice> = (set, get) => ({
  imageJobs: [],
  addImageJob: (job) => set((s) => ({ imageJobs: [job, ...s.imageJobs] })),
  updateImageJob: (id, updates) =>
    set((s) => ({ imageJobs: s.imageJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)) })),

  deleteRenders: (jobIds) => {
    const s = get();
    const out = removeRenders(s.imageJobs, s.chats, jobIds);
    if (out.removed.jobs.length || out.removed.messages.length) set({ imageJobs: out.imageJobs, chats: out.chats });
    return out.removed;
  },
  restoreRenders: (removed) => {
    const s = get();
    set(restoreRenders(s.imageJobs, s.chats, removed));
  },

  imageSettings: defaultImageSettings,
  setImageSettings: (s) =>
    set((state) => ({ imageSettings: { ...state.imageSettings, ...s } })),
});
