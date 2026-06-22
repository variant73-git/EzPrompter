// Generates evals/prompts/board-agent.txt from the SHIPPING BOARD_AGENT prompt.
//
// Why a generator instead of a hand-written stub:
//   The eval suite is a regression test for the agent's *routing logic* — which
//   tool it picks, when it promotes a prompt to a node, when it re-runs in place.
//   That logic lives entirely in BOARD_AGENT (lib/agent/prompts.js). If the eval
//   used a separate hand-written prompt, editing the real prompt would NOT be
//   caught by the suite. So we import the canonical string and wrap it in a thin
//   evaluation harness.
//
//   The harness adds one override: BOARD_AGENT tells the model never to mention
//   tool names (that's correct for real users, who never see tool calls). For the
//   eval we need an inspectable signal, so we ask it — for this one response only —
//   to name the tool + key args it WOULD call. The routing rules above it are the
//   thing under test; this just makes the decision observable.
//
// Run automatically as the first step of `bun run evals`. Also safe to run alone.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_AGENT } from '../lib/agent/prompts.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, 'prompts', 'board-agent.txt');

// {{user}} stays literal — promptfoo interpolates each test case's `vars.user`.
// NOTE: never put a line that is exactly "---" in this template — promptfoo
// treats a lone "---" as a multi-prompt separator and splits the file in two.
const template = `${BOARD_AGENT}

═══════════════════════════════════════════════════════════════════════════════
EVALUATION MODE — this is an automated regression test of your decision logic,
not a real user turn. Ignore the voice rule about never naming tools FOR THIS
RESPONSE ONLY. Read the request, apply the routing rules above, and output just
the single tool you would call first and its key arguments (e.g. \`createNode(type: "prompt", ...)\`).
If — and ONLY if — the rules say the move is genuinely ambiguous and you should
ask the user a clarifying question first, output \`ASK(short reason)\` instead of a
tool call. Otherwise always pick the tool. No prose, no narration — only the tool
call you would make, or ASK(...).

User message:
{{user}}
`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, template, 'utf8');
console.log(`[evals] wrote ${outPath} (${template.length} chars, BOARD_AGENT ${BOARD_AGENT.length} chars)`);
