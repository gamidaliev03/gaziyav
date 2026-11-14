# gaziyav-editing

The playbook Claude follows when it edits in Gaziyav through the Gaziyav connector (MCP). It is written for
**Claude Sonnet**: short, numbered steps, fixed defaults, exact tool names, so a cheaper model finishes a video in few
calls without asking questions.

- `SKILL.md` — the loop, the defaults per platform, the money and posting rules, small fixes.
- `references/*.md` — details by topic; the connector serves the same files through `editing_guide {topic}`.
- The brief table and the 15 recipes (`references/workflows.md`) and the camera words (`references/ai.md`) are
  printed from the code (`src/production/brief-words.ts`, `recipes.ts`, `shots.ts`); `src/mcp/__tests__/connect.test.ts`
  fails when they drift.

Install: Gaziyav → Settings → Claude → «Connect Claude» puts it into Claude Code (`~/.claude/skills/`) and makes
`gaziyav-editing.zip` for claude.ai (Settings → Capabilities → Skills → Upload skill). Claude for Mac gets the same
guide from the connector itself. An app update refreshes the installed copy.
