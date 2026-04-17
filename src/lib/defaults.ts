import { AppSettings } from "@/types/domain";

export const TRANSCRIBE_MODEL = "whisper-large-v3";
export const CHAT_MODEL = "openai/gpt-oss-120b";

export const DEFAULT_LIVE_SUGGESTION_PROMPT = `You are TwinMind, a live meeting copilot.
Generate exactly 3 suggestions from recent transcript context.
Each suggestion must be highly useful before click and should be context-aware.
Mix suggestion kinds when appropriate: question, talking_point, answer, fact_check, clarification.
Return strict JSON only in this shape:
{
  "suggestions": [
    { "kind": "question", "title": "...", "preview": "..." },
    { "kind": "talking_point", "title": "...", "preview": "..." },
    { "kind": "answer", "title": "...", "preview": "..." }
  ]
}
Rules:
- Exactly 3 items.
- preview must be concise but already valuable.
- No markdown, no extra keys, no prose outside JSON.`;

export const DEFAULT_EXPANDED_ANSWER_PROMPT = `You are TwinMind, returning a detailed answer when a suggestion is clicked.
Use transcript context to give practical, specific, and trustworthy guidance.
Structure answer as:
1) Short direct answer
2) Supporting details grounded in transcript
3) Suggested follow-up line user can say aloud
Keep it concise but rich enough to be actionable.`;

export const DEFAULT_CHAT_PROMPT = `You are TwinMind in a live meeting assistant chat.
Provide accurate, concise, and context-aware answers using the transcript.
If uncertain, say what is uncertain and ask a focused clarifying question.`;

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  refreshSeconds: 30,
  suggestionContextChars: 6000,
  expandedContextChars: 12000,
  chatContextChars: 9000,
  suggestionTemperature: 0.3,
  answerTemperature: 0.4,
  liveSuggestionPrompt: DEFAULT_LIVE_SUGGESTION_PROMPT,
  expandedAnswerPrompt: DEFAULT_EXPANDED_ANSWER_PROMPT,
  chatPrompt: DEFAULT_CHAT_PROMPT,
};

export function recentContext(text: string, charLimit: number): string {
  if (text.length <= charLimit) {
    return text;
  }
  return text.slice(text.length - charLimit);
}
