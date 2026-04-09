---
name: config-worker
description: Edits markdown, JSON, and shell config files in the SobatNgupi OpenClaw workspace
---

# Config Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve editing, restructuring, creating, or deleting configuration files in the SobatNgupi workspace — markdown prompts, JSON schemas, documentation, shell scripts, and workspace hygiene tasks.

## Required Skills

None

## Work Procedure

1. **Read the feature description thoroughly.** Understand exactly what files need to change and what the expected outcome is. Read every file listed in preconditions.

2. **Read all affected files in full** before making any changes. Understand the current content, structure, and any cross-references to other files.

3. **For file deletions/removals:** Use `rm -rf` for directories, `rm` for files. Verify the path is correct before deleting. After deletion, verify with `ls` that the target no longer exists.

4. **For file edits (markdown/JSON):**
   - Plan all changes before editing. Note what needs to change and why.
   - Edit using the Edit tool for targeted changes, or Create tool for full rewrites.
   - Preserve existing formatting conventions (WhatsApp-style markdown, Indonesian language, etc.)
   - For JSON files: validate with `jq . <file>` after editing.

5. **For content consolidation** (e.g., merging memory logs into a summary):
   - Read ALL source files first.
   - Extract key insights, patterns, and learnings — not raw conversation transcripts.
   - Organize extracted content into logical sections.
   - Write the consolidated output.
   - Delete source files after consolidation is verified.

6. **Cross-file consistency check:**
   - After editing, verify no contradictions were introduced with other files.
   - Check that cross-references (e.g., "baca TOOLS.md") still point to valid files.
   - Check field naming consistency (quantity not qty, menuName not name).

7. **Verification:**
   - Run any verification commands listed in the feature's verificationSteps.
   - For JSON files: `jq . <file>` must succeed.
   - For markdown: read the file back and confirm the changes are correct.
   - Check word counts if the feature requires reduction targets.

8. **Commit** with a descriptive message in the format: `chore: <what changed>` or `refactor: <what changed>`.

## Important Constraints

- All prompt/documentation files must be in **Indonesian (Bahasa Indonesia)** unless they are technical config files.
- **Preserve conversational warmth** — when editing SOBATNGUPI_PROMPT.md, keep personality and tone intact. Only tighten instructions.
- **Critical rules** (order flow separation, QRIS exec procedure, forbidden words) must remain reinforced in AGENTS.md even if also present in the main prompt.
- The workspace follows **OpenClaw conventions**: AGENTS.md is auto-loaded at session start, SOUL.md defines identity, skills/ contains procedures.
- **Never modify backend code or services** — this workspace is agent config only.
- Field naming standard: `quantity` (not qty), `menuName` (not name), `menuId`, shareloc as `{lat, lng, label?, source?}`.

## Example Handoff

```json
{
  "salientSummary": "Restructured SOBATNGUPI_PROMPT.md: tightened instructions from 966 to 780 words (-19%), added explicit order flow state machine with TUNGGU step, added QRIS expired-reuse workaround. Verified cross-file consistency with AGENTS.md and MEMORY.md. No contradictions found.",
  "whatWasImplemented": "Rewrote SOBATNGUPI_PROMPT.md with tighter instructions, explicit numbered order flow (capture → confirm → TUNGGU → payment), QRIS expired-reuse handling, and removed content duplicated in AGENTS.md. Preserved personality section and WhatsApp formatting conventions.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "wc -w SOBATNGUPI_PROMPT.md",
        "exitCode": 0,
        "observation": "780 words — 19% reduction from 966"
      },
      {
        "command": "grep -c 'TUNGGU' SOBATNGUPI_PROMPT.md",
        "exitCode": 0,
        "observation": "2 matches — TUNGGU instruction present in order flow and summary"
      },
      {
        "command": "grep -c 'expired' SOBATNGUPI_PROMPT.md",
        "exitCode": 0,
        "observation": "1 match — QRIS expired-reuse workaround section present"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Read AGENTS.md and compared critical rules with SOBATNGUPI_PROMPT.md",
        "observed": "Order flow separation, QRIS exec procedure, and forbidden words are consistent in both files. No contradictions."
      },
      {
        "action": "Checked all cross-references in restructured file",
        "observed": "References to menu-schema.json, ORDER_SYNC.md, TOOLS.md, MEMORY.md all point to existing files"
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature requires changes to the backend (localhost:3001) — agent config only
- File cross-references reveal missing files that should exist but don't
- Contradictions between files that can't be resolved without user input (e.g., conflicting business rules)
- Feature description is ambiguous about what content to keep vs. remove
