# AI agents (MCP)

FableChat includes an [MCP](https://modelcontextprotocol.io) server, so an AI agent such as Claude Code or Claude
Desktop can write cards for you: ask for *"a stoic dwarven blacksmith with a lorebook for his forge"* and it creates
them in your Library.

## Connecting

FableChat must be running. Then, for Claude Code:

```bash
claude mcp add fablechat -- node /absolute/path/to/CharacterBinderChat/mcp/server.mjs
```

For other MCP clients, run `node mcp/server.mjs` as a stdio server. Set `FABLE_URL` if FableChat is not on
`http://127.0.0.1:3000`, and `FABLE_PASSWORD` if you started it with one.

## What an agent can do

| Tool | What it does |
|---|---|
| `app_status` | Checks FableChat is reachable and counts your cards |
| `list_cards`, `get_card` | Reads characters, personas, lorebooks and scenarios |
| `create_character` | Makes a character, optionally with a lorebook of world details linked to them |
| `create_persona`, `create_lorebook`, `create_scenario` | Makes the other kinds |
| `update_card` | Changes some fields of a card, leaving the rest |
| `set_avatar` | Gives a character or persona a picture from a file on your computer |
| `delete_card` | Deletes a card, and says what used it |
| `undo_change` | Reverses any of the above |
| `parse_card_text` | Sorts pasted character text into card fields, without saving |

## Safety

- Every change appears in your open tab within seconds, named after the agent that made it, with **Undo**.
- Deletions are kept in history, so `undo_change` brings a card back with its links.
- If you and an agent edit the same card at the same moment, the agent's version is kept and you are told.
- The agent works through FableChat's own checks: it cannot write anything the editor would not accept.
