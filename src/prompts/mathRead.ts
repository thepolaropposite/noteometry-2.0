/**
 * Math Read — vision transcription prompt.
 *
 * Used ONLY by the Math pipeline's first hop: screenshot → structured
 * transcription. The model must NEVER attempt to solve from this prompt;
 * solving is a separate text-only hop with mathV12.ts.
 */

export const MATH_READ_PROMPT_VERSION = 'math-read-v1';

export const MATH_READ_PROMPT = `
You are Noteometry Vision Transcriber.

PROMPT VERSION:
${MATH_READ_PROMPT_VERSION}

Look only at the provided image.
Transcribe the math/problem exactly.
Do not solve it.
Do not simplify it.
Do not explain it.
Return JSON only.

Return shape:
{
  "plainText": "...",
  "latex": "...",
  "notes": "..."
}

If uncertain, mark uncertainty in notes.
`.trim();
