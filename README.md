# TwinMind Live Suggestions Assignment

Next.js + TypeScript implementation of a 3-column live meeting copilot:
1. Mic and transcript (left)
2. Live suggestions (middle)
3. Detailed chat answers (right)

The app uses Groq models as required:
1. `whisper-large-v3` for transcription
2. `openai/gpt-oss-120b` for suggestions and chat

No API key is hard-coded. Users paste their own Groq key in Settings.

## Stack Choices

1. Next.js App Router and TypeScript for fast full-stack iteration.
2. Server routes under `src/app/api/*` to keep Groq calls off the browser direct endpoint.
3. Client-side session state only (no auth, no persistence across reload), matching assignment requirements.

## Current Feature Coverage

1. Start and stop mic capture with `MediaRecorder`.
2. Audio chunk transcription through `/api/transcribe` (targeting ~30s chunks).
3. Transcript appends incrementally and auto-scrolls.
4. Suggestions refresh automatically while recording and manually via reload button.
5. Manual reload flushes the current recording chunk before suggestions request.
6. Exactly 3 suggestions expected each batch, with one corrective retry on malformed model output.
7. New suggestion batches prepend to top; older batches remain visible below.
8. Clicking a suggestion pushes it into chat and generates detailed answer.
9. Direct free-form chat input supported in same session thread.
10. Chat uses streaming response rendering for better perceived latency.
11. Export session button downloads transcript + suggestions + chat with timestamps as JSON.
12. Settings panel supports API key, prompts, context windows, and temperature tuning.

## Project Structure

1. `src/app/page.tsx` - Main app shell, panel orchestration, recorder flow, session state.
2. `src/app/api/transcribe/route.ts` - Groq Whisper transcription endpoint.
3. `src/app/api/suggestions/route.ts` - Live suggestions generation and output normalization.
4. `src/app/api/chat/route.ts` - Detailed answer endpoint with stream mode support.
5. `src/lib/defaults.ts` - Default prompts and tunable defaults.
6. `src/types/domain.ts` - Shared domain types for transcript, suggestions, chat, export.

## Prompt Strategy

1. Keep live suggestions tightly structured with strict JSON output constraints.
2. Ask for a context-aware mix of suggestion types:
	question, talking point, answer, fact check, clarification.
3. Keep suggestion previews useful even without click-through.
4. Use a separate expanded-answer system prompt for suggestion click interactions.
5. Use dedicated chat prompt for direct user questions.
6. Use bounded context windows (character-based) so latency remains stable in longer sessions.

## Latency Approach

1. Suggestions: record end-to-end refresh latency from click or timer trigger to render.
2. Chat: record both first-token latency and total completion latency.
3. Stream assistant tokens to the UI so users see progress quickly.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

4. In Settings, paste your Groq API key.

## Deployment (Vercel)

1. Push repository to GitHub.
2. Import repository into Vercel.
3. Deploy with default Next.js settings.
4. Share public app URL.

This app does not require a server-side secret for Groq because key input is provided per session in the UI and sent to API routes at runtime.

## Tradeoffs and Notes

1. Session-only state is intentional for assignment alignment.
2. Suggestion schema normalization favors reliability and exact-count compliance over rich formatting.
3. Streaming is implemented for chat answers; suggestions are single-response requests.
4. Additional hardening for production scale (rate limiting, persistent storage, auth) is intentionally out of scope.
