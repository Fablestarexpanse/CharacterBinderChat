// The small model FableChat downloads into Ollama for memory and image prompts
// (lib/server/backgroundModel.ts). Here, client-safe, so the chat's model picker
// can leave it out: it is for background jobs, not for talking to.
export const MEMORY_MODEL = { id: "qwen3:4b-instruct-2507-q4_K_M", label: "Qwen3 4B Instruct", gb: 2.5 } as const;
