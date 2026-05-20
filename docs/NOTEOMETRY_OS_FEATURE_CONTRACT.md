# Noteometry OS — Feature Contract

**Status:** Authoritative. This document is the rebuild rail. New work either honors a clause here, or amends a clause here first. Implementation that drifts from this contract is a regression even if it builds.

**Scope:** Noteometry OS — the standalone web-first product at `~/Documents/noteometry-os`. Not the Obsidian plugin; not the prior Obsidian-shelled prototypes. Those are reference material only (see `PORTING_MAP_FROM_OBSIDIAN.md`).

**Versioning:** Each numbered Law below is stable. Sub-points may be tightened over time; if a sub-point is removed or weakened, bump the date stamp and explain why in a `Why this changed` block.

**Last revised:** 2026-05-18

---

## 0. Identity (what Noteometry OS *is*)

Noteometry OS is a **standalone web-first canvas study workstation**. It runs in a browser, has its own app shell, its own persistence layer, its own AI plumbing, and its own UI vocabulary. It is built on tldraw v5 because that gives us a serious infinite canvas with no negotiation needed.

It is **not**:
- an Obsidian plugin
- an Obsidian theme
- a chat client with a canvas attached
- a generic AI playground

The product is a **commander's workstation** for working through STEM problems by hand on a real engineering grid and getting deterministic, structured math help when needed. Every Law below exists to keep the product from drifting back into "another AI chat app with a whiteboard slapped on."

---

## Law 1 — Standalone Product Law

Noteometry OS is web-first and standalone.

- **Do not rebuild the Obsidian plugin shell.**
- **Do not import any Obsidian APIs** (`obsidian`, `requestUrl`, `Notice`, `Plugin`, `WorkspaceLeaf`, etc.).
- **Do not create Obsidian compatibility shims**, even "just for now."
- Old `noteometry-obsidian` is **read-only reference material**. We port *concepts* and *math*, not infrastructure.
- Network calls go through standard `fetch`, optionally routed through the Vite dev proxy (`/lmstudio` → LM Studio).
- Persistence is browser-native (`localStorage` for app state; tldraw IndexedDB for canvas content per page).

---

## Law 2 — Canvas Law (the canvas is stupid on purpose)

Nothing draws directly on the raw canvas except:

1. **Ink strokes** — pen, eraser. These are first-class tldraw shapes.
2. **Math Palette character/symbol marks** — single-glyph "stamps" the user drops at a point.

Everything else is a **Drop-In™** (Law 3). The canvas does not know what a table is, what a chat is, what a PDF page is, what an AI answer is — those are anchored cards living *on top of* the canvas substrate.

**Rationale:** the rasterizer in `src/features/lasso/rasterize.ts` (v1.10) was named "the dumb pipe" for a reason. The canvas is pixels; the *model* does interpretation. The same discipline applies inward: keeping the canvas dumb means tldraw never needs to know what a Circuit Sniper card is, and a future Drop-In™ never needs to know what tldraw is.

---

## Law 3 — Drop-In™ Law

A **Drop-In™** is a self-contained mini-app anchored to the canvas with its own:

- **Identity** (stable id)
- **Title**
- **Position** (canvas-space x, y)
- **Size** (w, h; resizable)
- **State** (per-instance, scoped to the Drop-In™'s persistence record)
- **UI** (renders inside the Drop-In™ frame; no global mounting)
- **Lifecycle** (spawn, move, resize, delete, serialize, hydrate)

The current Drop-In™ catalog (planned):

| Drop-In™ | Purpose |
|---|---|
| **Text** | Rich text block. |
| **Table** | Editable table. |
| **Image** | Anchored image. |
| **PDF** | PDF page or range. |
| **Math** | LaTeX/MathML mini-card (verified math snippet). |
| **Chat** | Localized canvas-anchored conversation (v1.10 ChatDropin reference, but secondary to the AI Pane). |
| **Circuit Sniper** | Circuit analysis mini-app. |
| **Graph** | Plot / function grapher. |
| **Calculator** | Scratch calculator. |
| **AI Result** | A pinned answer snapshot pulled from the AI Pane. |

Notes:

- Drop-Ins™ never live in the right-click menu as their own dedicated entries beyond the **Insert** section that lists what's insertable. The menu inserts a Drop-In™ at the cursor; the Drop-In™ itself owns its tools.
- Drop-Ins™ can **export** themselves (see Law 11 — Word/MathML).
- A future Drop-In™ must declare a serialization shape and a hydrate function. No ad-hoc state-on-canvas.

---

## Law 4 — AI Pane Law

The **AI Pane** is **persistent app chrome**, not a Drop-In™. It lives on the right side of the window, always (collapsible, not removable).

The AI Pane owns:

1. **Math pipeline** entry points (Read Math, Solve)
2. **General pipeline** entry points (Capture General, Ask AI)
3. **Provider/model settings** (per-job: Math Read / Math Solve / General)
4. **Prompt inspection** (View Prompt + Copy Prompt; version labels surfaced)
5. **Word/MathML export** (Copy for Word on every assistant message)
6. **Chat/result history** (mode-scoped logs; persisted to `localStorage`)

The AI Pane is **not**:

- a Drop-In™
- a floating overlay
- conditionally hidden by tool state
- a place where canvas tools live

Reference for this Law: v1.6.6 `src/components/Panel.tsx` + `src/components/ChatPanel.tsx`. We deliberately do **not** follow v1.10.0's choice to delete the right-side AI Pane and re-home chat into canvas Drop-Ins™. v1.10's Drop-In™ rationale is right; its removal of persistent AI chrome was a regression for Dan's workflow.

---

## Law 5 — Math Pipeline Law

The Math pipeline is a **two-hop, verification-gated** flow. No shortcuts.

```
[1] User writes math on canvas (ink + Math Palette marks)
[2] User lassos or selects the math region
[3] User clicks Read Math (AI Pane, or right-click → Math → Read Math)
[4] Noteometry captures a screenshot of the selection
       (editor.toImageDataUrl — pixels only, no shape JSON, no OCR)
[5] Screenshot goes to the Math Read VISION model
       with the math-read-v1 transcription prompt
[6] Model returns JSON: { plainText, latex, notes }
[7] Result populates the Preview + Verified Input area
[8] Dan VERIFIES / EDITS the input — this step is MANDATORY
[9] User clicks Solve
[10] Solve sends the verified TEXT/LaTeX ONLY (no image)
        to the Math Solve TEXT model
        with the FULL Math v12 system prompt
        and a user message wrapping the verified input in
        <VERIFIED_PROBLEM>…</VERIFIED_PROBLEM>
[11] Answer lands in the AI Pane chat
[12] Every assistant message exposes:
        Copy LaTeX | Copy v12 Text | Copy for Word (MathML)
```

Non-negotiables:

- **Solve never sees the screenshot.** Vision is a transcription step; solving is a reasoning step. They are not the same call.
- **Solve is disabled** until the Verified Input field is non-empty.
- The Solve prompt **always** carries the entire Math v12 protocol body. No "shortened" or "remember v12" variants.
- The Verified Input is **the contract** between Dan and the solver. If recognition is wrong and Dan ships it anyway, that's on the human — but the model can never silently re-interpret pixels at solve time.

---

## Law 6 — General Pipeline Law

The General pipeline is a **one-hop vision call** for mixed media.

```
[1] User lassos / selects mixed media on the canvas
[2] User clicks Capture General (AI Pane, or right-click)
[3] Noteometry captures a screenshot of the selection
[4] User types a prompt in the Ask AI textarea
[5] Send → screenshot + prompt → General VISION model
       with the general-vision-v1 system prompt
[6] Answer lands in the AI Pane chat (General mode)
```

Non-negotiables:

- **No OCR.** Local OCR is forbidden; the model sees pixels.
- **No shape JSON.** We never send tldraw shape records.
- **No object parsing.** We never preprocess "[Text Box]" / "[Table]" placeholders. The v1.10 ChatDropin commit message and the rasterizer's "dumb pipe" doctrine apply.
- The General prompt does **not** invoke Math v12 unless the user explicitly asks for it. General is the "ask anything about what I see" lane; Math is the deterministic lane.

---

## Law 7 — UI Law

Visible persistent UI is **exactly**:

1. **OneNote-style top shell** — notebook breadcrumb + section tabs + add-section button.
2. **Right-side page rail** — page list for the active section, with `+ Add page`.
3. **AI Pane** — right-side (Law 4).
4. **Zoom control** — bottom-right (− / xx% / +).
5. **Canvas** — center, dumb (Law 2).
6. **Toast** — transient, non-modal.

**Right-click is the tool palette.** All canvas commands live there — and only there:

- One flat list. No nested submenus. No hover-reveal flyouts. No hidden command groups.
- Section headers are visible group labels (not clickable, not flyouts).
- ADHD doctrine: out of sight = out of mind. Everything must be visible at once.

What is **not** allowed on screen:
- floating tool HUDs
- bottom-right Drop-In™ launchers
- persistent toolbars for tool selection
- canvas-mounted tool buttons
- second right-click menu / context-of-context menus

The right-click menu's command set is the canonical surface; if a feature needs to be reachable, it goes here, full stop.

---

## Law 8 — Visual Law

Canvas background is **battleship grey (`#6f7479`)**, painted on `.noteometry-canvas-shell`.

Grid is **engineering graph paper**, painted with CSS layered linear-gradients, 1 CSS inch = 96 px:

- **Minor grid:** every **12 px** (`1/8"`), `rgba(255,255,255,0.16)`, 1 px lines.
- **Major grid:** every **96 px** (`1"`), `rgba(255,255,255,0.34)`, 1.5 px lines.

tldraw's own grid is disabled (`editor.updateInstanceState({ isGridMode: false })`); tldraw's `.tl-background` and `.tl-canvas` are forced `background: transparent` so the engineering paper shows through.

This is the *only* permitted canvas background. No dot-grid mode, no themed surfaces, no "paper" mode toggle. If Dan wants a different background later, this Law is amended before code changes.

---

## Law 9 — Prompt Law

Every AI call uses a **named, versioned, inspectable, copyable** prompt template. Prompts live in `src/prompts/` and are imported through `src/prompts/index.ts`.

Current prompt registry:

| Template | Version | File | Used by |
|---|---|---|---|
| Math Read | `math-read-v1` | `src/prompts/mathRead.ts` | Math pipeline, step 5 |
| Math v12 | `math-v12-2026-03-09` | `src/prompts/mathV12.ts` | Math pipeline, step 10 (Solve) |
| General Vision | `general-vision-v1` | `src/prompts/generalVision.ts` | General pipeline |

Rules:

- **Solve always uses the full Math v12 body** (ported verbatim from v1.6.6 `src/features/pipeline/presets.ts` "solve" preset). Not a summary. Not a paraphrase. Not "you remember v12, right?"
- **`buildMathV12UserMessage(verified)` is the only path to the user message.** It wraps the verified input in `<VERIFIED_PROBLEM>…</VERIFIED_PROBLEM>` and prepends the "Here is the ENTIRE verified problem…" preamble.
- **View Prompt** must show the exact bytes that will be sent (system + user, with the current Verified Input already injected for Math v12).
- **Copy Prompt** must write the same exact bytes to the clipboard.
- **Prompt version labels** appear: in the AI Pane diagnostics strip, in the per-job settings header, and as `prompt <version>` meta on every chat entry.
- New prompts go into `src/prompts/`, get a version string, get exported from `index.ts`. They never live inline in a component.

---

## Law 10 — Provider Law

Workflow is **deterministic**. Model choice is **configurable**.

Three independently-configured **jobs**:

| Job | Modality | Default | Purpose |
|---|---|---|---|
| `mathRead` | Vision | LM Studio @ `/lmstudio/v1` · `google/gemma-4-26b-a4b` | Transcribe screenshot to JSON |
| `mathSolve` | Text | LM Studio @ `/lmstudio/v1` · `google/gemma-4-26b-a4b` | Solve verified text under Math v12 |
| `general` | Vision | LM Studio @ `/lmstudio/v1` · `google/gemma-4-26b-a4b` | Mixed-media vision Q&A |

Each job has its own `provider`, `baseUrl`, `apiKey`, `model`. Dan can mix providers — e.g. `qwen/qwen3-vl-30b` for Math Read while keeping `google/gemma-4-26b-a4b` for Math Solve.

Provider catalog (`src/lib/aiProviders.ts`):

| Provider | Status | Notes |
|---|---|---|
| **LM Studio / Local** | wired | Routed through Vite proxy (`/lmstudio` → `http://127.0.0.1:1234`). |
| **OpenAI / ChatGPT** | wired | OpenAI-compatible. Browser CORS may block in dev; production needs a server proxy. |
| **Claude / Anthropic** | visible, **not implemented** | Different request schema (`x-api-key` + `/messages`). Banner shown in UI. |
| **Gemini** | visible, **not implemented** | Different request schema (`?key=` + `generateContent`). Banner shown in UI. |
| **Perplexity** | wired | OpenAI-compatible `/chat/completions`. `/models` may not exist. |
| **Grok / xAI** | wired | OpenAI-compatible. |
| **Custom OpenAI-compatible** | wired | BYO base URL; optional bearer key. |

Non-negotiables:

- **API keys live only in `localStorage` and as `Authorization: Bearer` headers.** Never logged. Never echoed. Never sent to telemetry.
- **Unimplemented providers show a visible banner** ("Provider adapter not implemented yet. Use LM Studio or Custom OpenAI-compatible for now.") and `sendChat` throws the same string.
- **Test Provider** prefers `/models` when supported, falls back to a tiny chat ping otherwise.
- **Refresh Models** is only shown for providers with `modelsPath`.

---

## Law 11 — Word / MathML Export Law

Every assistant chat message in the AI Pane exposes three copy actions:

| Action | Mechanism | Result |
|---|---|---|
| **Copy LaTeX** | `navigator.clipboard.writeText(entry.text)` | Raw v12 / LaTeX output as plain text. |
| **Copy v12 Text** | same | Currently identical to Copy LaTeX; placeholder for a future v12-text-only filter. |
| **Copy for Word** | `buildClipboardPayload` → `toMathMLForClipboard` → `ClipboardItem({'text/html', 'text/plain'})` | MathML-bearing HTML for Word; LaTeX fallback for everything else. |

Implementation lives in `src/lib/mathml.ts`, ported from v1.6.6 `src/lib/mathml.ts`. The KaTeX call uses `output: 'mathml'`, and the bare `<math>…</math>` is extracted via the same regex.

Non-negotiables:

- The Word path uses **real MathML**, not a fake-success stub. If `ClipboardItem` is unavailable, the function falls back to plain text and the call still returns successfully — but it does **not** claim a Word paste succeeded.
- Future Drop-Ins™ that hold math content (Math Drop-In™, AI Result Drop-In™) export through the same `mathml.ts` API. We do not fork the export path.

---

## Law 12 — Persistence & Migration Law

Two persistence surfaces:

1. **App state** (`localStorage`): pane open state, mode, provider configs, prompt logs, verified input, draft text, nav state (notebook/section/page).
2. **Canvas content** (tldraw IndexedDB): per-page strokes and shapes, keyed by `nm-page-<pageId>`.

Schema versions are encoded in storage keys (e.g. `noteometry-os:math-message-pane:v3`). When a schema changes:

- Bump the version suffix in the key.
- Provide a best-effort migration from the prior key, or seed fresh defaults.
- Never silently mutate the prior key in place.

---

## Anti-Regression Checklist (CI in spirit; eyes-on for now)

Before any PR or hand-off, all of the following must be true. If any is false, the change is a regression even if it builds and runs.

- [ ] No `import … from 'obsidian'` anywhere in `src/`.
- [ ] No `requestUrl`, `Notice`, or `Plugin` symbols anywhere in `src/`.
- [ ] No reference to `tldraw`'s `'laser'` tool anywhere in `src/`.
- [ ] `editor.updateInstanceState({ isGridMode: false })` is set on mount.
- [ ] `.noteometry-canvas-shell` background-color is `#6f7479` and uses 12 px + 96 px gradients.
- [ ] `.tl-background` and `.tl-canvas` are forced transparent inside the shell.
- [ ] Right-click `ContextMenu` items contain **no** `submenu` field.
- [ ] No floating toolbar / HUD / bottom Drop-In™ launcher rendered in `App.tsx`.
- [ ] Math pipeline Solve **does not** include any `image_url` content part in the request body.
- [ ] Math pipeline Solve **always** uses `MATH_V12_SYSTEM` as `system` (full body, not summarized).
- [ ] Math pipeline Solve **always** wraps user content via `buildMathV12UserMessage`.
- [ ] Solve button is `disabled` when `verifiedInput.trim() === ''`.
- [ ] `console.log` (or any logger) never receives `apiKey` or any object containing `apiKey`.
- [ ] Vite proxy `/lmstudio` → `http://127.0.0.1:1234` is present and unmodified.
- [ ] LM Studio default base URL is `/lmstudio/v1` (not `http://localhost:1234`).
- [ ] AI Pane is rendered as persistent chrome — not gated behind a tool, not a Drop-In™.
- [ ] `build` (`tsc -b && vite build`) passes.
- [ ] Manually: lasso math → Read Math → preview populates; Solve → answer arrives; Copy for Word produces MathML.

---

## Why this contract exists

The product has been rewritten enough times to know its own failure modes. Each Law above came from a specific drift. The contract is the rail that says: *the next rewrite is allowed to be ambitious about the code, but not about the product*.

If a Law starts feeling wrong, **amend the contract first, then change the code**.
