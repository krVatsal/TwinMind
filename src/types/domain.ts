export type SuggestionKind =
  | "question"
  | "talking_point"
  | "answer"
  | "fact_check"
  | "clarification";

export interface TranscriptChunk {
  id: string;
  text: string;
  createdAt: string;
}

export interface SuggestionCard {
  id: string;
  kind: SuggestionKind;
  title: string;
  preview: string;
}

export interface SuggestionBatch {
  id: string;
  createdAt: string;
  suggestions: SuggestionCard[];
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  source: "manual" | "suggestion" | "assistant";
}

export interface AppSettings {
  apiKey: string;
  refreshSeconds: number;
  suggestionContextChars: number;
  expandedContextChars: number;
  chatContextChars: number;
  suggestionTemperature: number;
  answerTemperature: number;
  liveSuggestionPrompt: string;
  expandedAnswerPrompt: string;
  chatPrompt: string;
}

export interface ExportPayload {
  exportedAt: string;
  transcript: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatHistory: ChatMessage[];
}
