import { NextResponse } from "next/server";

import { CHAT_MODEL, recentContext } from "@/lib/defaults";
import { SuggestionCard, SuggestionKind } from "@/types/domain";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

interface SuggestionsBody {
  apiKey: string;
  transcriptText: string;
  prompt: string;
  contextChars: number;
  temperature: number;
}

function safeKind(kind: string): SuggestionKind {
  const allowed: SuggestionKind[] = [
    "question",
    "talking_point",
    "answer",
    "fact_check",
    "clarification",
  ];

  if (allowed.includes(kind as SuggestionKind)) {
    return kind as SuggestionKind;
  }
  return "clarification";
}

function normalizeSuggestions(raw: unknown): SuggestionCard[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const maybeArray = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(maybeArray)) {
    return [];
  }

  return maybeArray
    .slice(0, 3)
    .map((entry, idx) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const title = String(item.title ?? "").trim();
      const preview = String(item.preview ?? "").trim();
      const kind = safeKind(String(item.kind ?? "clarification"));

      if (!title || !preview) {
        return null;
      }

      return {
        id: `${Date.now()}-${idx}`,
        kind,
        title,
        preview,
      } satisfies SuggestionCard;
    })
    .filter((value): value is SuggestionCard => Boolean(value));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SuggestionsBody;

    if (!body.apiKey?.trim()) {
      return NextResponse.json({ error: "Missing Groq API key." }, { status: 400 });
    }

    const context = recentContext(body.transcriptText || "", body.contextChars || 6000);

    let suggestions = normalizeSuggestions(
      await requestSuggestions({
        apiKey: body.apiKey,
        prompt: body.prompt,
        context,
        temperature: body.temperature,
      }),
    );

    if (suggestions.length !== 3) {
      suggestions = normalizeSuggestions(
        await requestSuggestions({
          apiKey: body.apiKey,
          prompt: `${body.prompt}\n\nYour previous response was malformed. Retry now with strict JSON only and exactly 3 suggestions.`,
          context,
          temperature: body.temperature,
        }),
      );
    }

    if (suggestions.length !== 3) {
      suggestions = fallbackSuggestions(context);
    }

    return NextResponse.json({
      createdAt: new Date().toISOString(),
      suggestions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unexpected suggestion error.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

async function requestSuggestions(input: {
  apiKey: string;
  prompt: string;
  context: string;
  temperature: number;
}): Promise<unknown> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: Number.isFinite(input.temperature) ? input.temperature : 0.3,
      messages: [
        {
          role: "system",
          content: input.prompt,
        },
        {
          role: "user",
          content: `Recent transcript context:\n\n${input.context}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Suggestion generation failed: ${detail}`);
  }

  const completion = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = completion.choices?.[0]?.message?.content ?? "";
  return parseJson(content);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function fallbackSuggestions(context: string): SuggestionCard[] {
  const snippet = context.slice(Math.max(0, context.length - 260));

  return [
    {
      id: `${Date.now()}-0`,
      kind: "question",
      title: "Clarify the top decision",
      preview: "Ask: What exact decision do we need to make in the next 10 minutes?",
    },
    {
      id: `${Date.now()}-1`,
      kind: "talking_point",
      title: "Summarize current thread",
      preview: snippet
        ? `Talking point: Based on recent context, align around this thread: ${snippet}`
        : "Talking point: Summarize key constraints and confirm ownership before moving on.",
    },
    {
      id: `${Date.now()}-2`,
      kind: "clarification",
      title: "Request missing assumptions",
      preview: "Clarify assumptions, timeline, and measurable success criteria before concluding.",
    },
  ];
}
