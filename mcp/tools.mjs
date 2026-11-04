// ─── FableChat MCP tools ──────────────────────────────────────────────────────
// The tool definitions, kept apart from the stdio wiring (server.mjs) so they can
// be tested with a fake `call`. Every tool is a thin request to FableChat's own
// HTTP API: there is no card logic here. Validation, conversion and the undo
// history all live in the app, so an agent and the UI can never disagree about
// what a valid card is.

import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

const CARD_TYPES = ["character", "lorebook", "persona", "scenario"];
const cardType = z.enum(CARD_TYPES).describe("character, lorebook, persona or scenario");

const loreEntry = z.object({
  keys: z.array(z.string()).describe("Trigger keywords; the entry is injected when one appears in the recent conversation"),
  content: z.string().describe("What the model should know when those keywords come up"),
  secondary_keys: z.array(z.string()).optional().describe("With selective, one of these must ALSO appear"),
  selective: z.boolean().optional(),
  constant: z.boolean().optional().describe("Always inject, regardless of keywords"),
  case_sensitive: z.boolean().optional(),
  enabled: z.boolean().optional(),
  comment: z.string().optional().describe("A note for the author, never sent to the model"),
  priority: z.number().optional().describe("Higher injects first when the token budget runs out"),
});

const characterFields = {
  name: z.string(),
  description: z.string().describe("Who they are. Injected into every prompt. Required."),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  first_mes: z.string().optional().describe("Their opening message. {{char}} and {{user}} are filled in."),
  mes_example: z.string().optional().describe("Example dialogue; separate exchanges with <START>"),
  system_prompt: z.string().optional(),
  post_history_instructions: z.string().optional(),
  alternate_greetings: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  creator: z.string().optional(),
  creator_notes: z.string().optional(),
};

const WRITE_NOTE = " The change is written to FableChat's server and appears in any open tab within a few seconds. It is recorded and can be reversed with undo_change.";

const ro = { readOnlyHint: true, openWorldHint: false };
const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/**
 * @param call (method, path, body?) => Promise<any>  performs the HTTP request and
 *        throws an Error carrying the server's own message on failure.
 */
export function buildTools(call) {
  return [
    {
      name: "app_status",
      title: "FableChat status",
      description: "Check that FableChat is running and reachable, and how many cards of each kind it holds. Call this first if anything fails.",
      inputSchema: {},
      annotations: ro,
      handler: async () => {
        const counts = {};
        for (const t of CARD_TYPES) counts[t] = (await call("GET", `/api/cards?type=${t}`)).cards.length;
        const { rev } = await call("GET", "/api/state/changes?since=999999999");
        return { reachable: true, revision: rev, cards: counts };
      },
    },
    {
      name: "list_cards",
      title: "List cards",
      description: "List every card of one kind: id, name and a short detail. Use get_card for the full contents.",
      inputSchema: { type: cardType },
      annotations: ro,
      handler: async ({ type }) => (await call("GET", `/api/cards?type=${type}`)).cards,
    },
    {
      name: "get_card",
      title: "Get a card",
      description: "Read one card in full, in its interchange format (a character is a Tavern Card V2 with its lorebook embedded).",
      inputSchema: { type: cardType, id: z.string().describe("The id from list_cards") },
      annotations: ro,
      handler: async ({ type, id }) => (await call("GET", `/api/cards/${type}/${encodeURIComponent(id)}`)).card,
    },
    {
      name: "create_character",
      title: "Create a character",
      description: "Create a character. Name and description are required. Optionally attach a lorebook of world details that is created and linked to them." + WRITE_NOTE,
      inputSchema: { ...characterFields, lorebook: z.object({ name: z.string().optional(), entries: z.array(loreEntry) }).optional() },
      annotations: additive,
      handler: async ({ lorebook, ...fields }) => {
        const card = { spec: "chara_card_v2", spec_version: "2.0", data: { ...fields } };
        if (lorebook) {
          card.data.character_book = {
            name: lorebook.name ?? `${fields.name}'s world`, extensions: {},
            entries: lorebook.entries.map((e, i) => ({ extensions: {}, enabled: true, insertion_order: i, ...e })),
          };
        }
        return call("POST", "/api/cards/character", { card });
      },
    },
    {
      name: "create_lorebook",
      title: "Create a lorebook",
      description: "Create a lorebook: keyword-triggered world details that are injected into a chat when the keywords appear." + WRITE_NOTE,
      inputSchema: { name: z.string(), description: z.string().optional(), entries: z.array(loreEntry).min(1) },
      annotations: additive,
      handler: async (a) => call("POST", "/api/cards/lorebook", { card: { ...a, entries: a.entries.map((e, i) => ({ enabled: true, insertion_order: i, ...e })) } }),
    },
    {
      name: "create_persona",
      title: "Create a persona",
      description: "Create a persona: who the USER is in the story, so characters address them correctly." + WRITE_NOTE,
      inputSchema: { name: z.string(), description: z.string() },
      annotations: additive,
      handler: async (a) => call("POST", "/api/cards/persona", { card: { spec: "persona_card_v1", ...a } }),
    },
    {
      name: "create_scenario",
      title: "Create a scenario",
      description: "Create a scenario: a reusable situation a story can open in, with an optional opening message." + WRITE_NOTE,
      inputSchema: { name: z.string(), scenario: z.string(), first_mes: z.string().optional() },
      annotations: additive,
      handler: async (a) => call("POST", "/api/cards/scenario", { card: { spec: "scenario_card_v1", ...a } }),
    },
    {
      name: "update_card",
      title: "Update a card",
      description:
        "Change fields of an existing card; fields you leave out are untouched, and an empty string clears an optional field. " +
        "Character fields: name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, alternate_greetings, tags, creator, creator_notes. " +
        "Lorebook: name, description, entries (replaces all entries). Persona: name, description. Scenario: name, scenario, first_mes. " +
        "An unknown field is an error that lists the allowed ones." + WRITE_NOTE,
      inputSchema: { type: cardType, id: z.string(), changes: z.record(z.string(), z.unknown()).describe("Field names to new values") },
      annotations: destructive,
      handler: async ({ type, id, changes }) => call("PATCH", `/api/cards/${type}/${encodeURIComponent(id)}`, { changes }),
    },
    {
      name: "delete_card",
      title: "Delete a card",
      description: "Delete a card. The response says what depended on it (usedBy, and a warning): deleting a character leaves chats that can no longer continue, and deleting a lorebook clears its owner's link. It is kept in history, so undo_change brings it back, links included." + WRITE_NOTE,
      inputSchema: { type: cardType, id: z.string() },
      annotations: destructive,
      handler: async ({ type, id }) => call("DELETE", `/api/cards/${type}/${encodeURIComponent(id)}`),
    },
    {
      name: "set_avatar",
      title: "Set a picture",
      description: "Give a character or persona a picture from an image file on this computer (PNG, JPEG, GIF or WebP, up to 25 MB). The original is kept, so exported cards carry it at full resolution." + WRITE_NOTE,
      inputSchema: {
        type: z.enum(["character", "persona"]),
        id: z.string(),
        path: z.string().describe("Absolute path to the image file"),
      },
      annotations: destructive,
      handler: async ({ type, id, path: file }) => {
        // Read here, in the MCP server, with the agent's own permissions; the app
        // only ever receives bytes and never opens a path it was handed.
        if (!path.isAbsolute(file)) throw new Error("path must be absolute");
        const bytes = await fs.readFile(file).catch((e) => { throw new Error(`Could not read ${file}: ${e.code ?? e.message}`); });
        return call("PUT", `/api/cards/${type}/${encodeURIComponent(id)}/avatar`, bytes);
      },
    },
    {
      name: "undo_change",
      title: "Undo a change",
      description: "Reverse a create, update or delete, using the historyId its response returned. A created character's lorebook is removed with it. Each change can be undone once.",
      inputSchema: { historyId: z.number().int() },
      annotations: destructive,
      handler: async ({ historyId }) => call("POST", "/api/cards/undo", { historyId }),
    },
    {
      name: "parse_card_text",
      title: "Sort pasted text into character fields",
      description: "Split a pasted character (headed sections, W++, JSON, or plain paragraphs) into card fields, without saving anything. Pass the result to create_character.",
      inputSchema: { text: z.string() },
      annotations: ro,
      handler: async ({ text }) => call("POST", "/api/cards/parse-text", { text }),
    },
  ];
}

/** Build the HTTP caller. Failures throw the server's own message, so an agent sees the real reason. */
export function makeCall({ baseUrl, password, source, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/+$/, "");
  return async (method, path, body) => {
    const headers = { "X-Fable-Source": source() };
    const raw = body instanceof Uint8Array;
    if (body !== undefined) headers["Content-Type"] = raw ? "application/octet-stream" : "application/json";
    if (password) headers.Authorization = `Basic ${Buffer.from(`fable:${password}`).toString("base64")}`;

    let res;
    try {
      res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    } catch (e) {
      throw new Error(`Could not reach FableChat at ${base}. Is it running? Start it with \`npm run dev\` or \`npm start\`. (${e.cause?.code ?? e.message})`);
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401) throw new Error("FableChat asked for a password. Set FABLE_PASSWORD in this MCP server's environment to match the one FableChat was started with.");
    if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `FableChat returned HTTP ${res.status}`);
    return data;
  };
}
