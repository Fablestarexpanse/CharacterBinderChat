/**
 * ComfyUI provider adapter.
 * ComfyUI runs locally and exposes a WebSocket + REST API.
 * Docs: https://github.com/comfyanonymous/ComfyUI
 *
 * Real integration TODO:
 * 1. Connect the WebSocket at ws://baseUrl/ws?clientId=<uuid> to get live progress.
 * 2. Replace queuePrompt mock with real POST /prompt.
 * 3. Replace getImage mock with real GET /view?filename=...
 */

import type { ImageJob, ImageGenerationSettings } from "@/lib/types";

const DEFAULT_BASE_URL = "http://127.0.0.1:8188";

export class ComfyUIProvider {
  private baseUrl: string;
  private clientId: string;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.clientId = crypto.randomUUID();
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Queue a prompt to ComfyUI.
   * @param workflowJson - The raw ComfyUI workflow JSON (exported from ComfyUI web UI as API format)
   * @param promptValues - Key-value overrides injected into the workflow nodes
   * @returns The ComfyUI prompt ID
   */
  async queuePrompt(
    workflowJson: Record<string, unknown>,
    promptValues: Record<string, unknown> = {}
  ): Promise<string> {
    // Merge prompt values into workflow (each key maps to a node + field)
    const merged = deepMergeWorkflow(workflowJson, promptValues);

    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: merged, client_id: this.clientId }),
    });

    if (!res.ok) throw new Error(`ComfyUI queue error: ${res.status}`);
    const data = await res.json();
    return data.prompt_id as string;
  }

  async getHistory(promptId?: string): Promise<Record<string, unknown>> {
    const url = promptId
      ? `${this.baseUrl}/history/${promptId}`
      : `${this.baseUrl}/history`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ComfyUI history error: ${res.status}`);
    return res.json();
  }

  /**
   * Fetch a generated image as a data URL.
   * @param filename - The filename returned in ComfyUI history outputs
   * @param subfolder - Usually "" or "output"
   * @param type - Usually "output"
   */
  async getImage(
    filename: string,
    subfolder = "",
    type = "output"
  ): Promise<string> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const res = await fetch(`${this.baseUrl}/view?${params}`);
    if (!res.ok) throw new Error(`ComfyUI image error: ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  async uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`ComfyUI upload error: ${res.status}`);
    const data = await res.json();
    return data.name as string;
  }

  async loadWorkflowTemplate(templatePath: string): Promise<Record<string, unknown>> {
    const res = await fetch(templatePath);
    if (!res.ok) throw new Error(`Failed to load workflow: ${templatePath}`);
    return res.json();
  }

  /** Build a mock ImageJob for UI development before real ComfyUI is connected */
  createMockJob(settings: ImageGenerationSettings, chatId?: string): ImageJob {
    return {
      id: crypto.randomUUID(),
      chatId,
      prompt: settings.prompt,
      status: "complete",
      settings,
      outputUrls: ["/placeholder-image.png"],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject prompt overrides into a ComfyUI API workflow JSON.
 * ComfyUI workflows are node graphs; each node has an "inputs" object.
 * promptValues format: { "nodeId.inputKey": value }
 */
function deepMergeWorkflow(
  workflow: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const result = structuredClone(workflow) as Record<string, { inputs: Record<string, unknown> }>;
  for (const [key, value] of Object.entries(overrides)) {
    const [nodeId, inputKey] = key.split(".");
    const node = result[nodeId];
    if (node?.inputs && inputKey) {
      node.inputs[inputKey] = value;
    }
  }
  return result as Record<string, unknown>;
}
