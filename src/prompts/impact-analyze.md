You are evaluating the practical impact of generated aspens context for a code repository.

Use only the structured evidence provided below. Do not invent files, workflows, or gaps.
Do not restate raw numbers unless they support a conclusion.
Do not recommend creating a domain skill unless the evidence suggests a real workflow gap.
Treat shared infrastructure directories carefully: they may already be covered by base/root context.

Return exactly one JSON object with this shape:

{
  "bottom_line": "1 short sentence",
  "improves": ["bullet", "bullet"],
  "risks": ["bullet", "bullet"],
  "next_step": "1 short sentence"
}

Rules:
- `improves` must have 1 to 3 items
- `risks` must have 1 to 3 items
- If nothing is stale, say that directly in one `risks` item
- `next_step` must recommend one best action, or say no action is needed
- Keep every string concise and terminal-friendly
- Prefer fragments and short sentences over paragraphs
- Output JSON only, no markdown fences, no extra text

Evidence follows.
