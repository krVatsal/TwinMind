import { NextResponse } from "next/server";

import { CHAT_MODEL, recentContext } from "@/lib/defaults";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ChatBody {
  apiKey: string;
  transcriptText: string;
  contextChars: number;
  temperature: number;
  systemPrompt: string;
  userPrompt: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatBody;

    if (!body.apiKey?.trim()) {
      return NextResponse.json({ error: "Missing Groq API key." }, { status: 400 });
    }

    const context = recentContext(body.transcriptText || "", body.contextChars || 9000);

    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: Number.isFinite(body.temperature) ? body.temperature : 0.4,
        messages: [
          {
            role: "system",
            content: body.systemPrompt,
          },
          {
            role: "user",
            content: `Transcript context:\n\n${context}\n\nUser request:\n${body.userPrompt}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: "Chat generation failed.", detail },
        { status: response.status },
      );
    }

    const completion = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const answer = completion.choices?.[0]?.message?.content?.trim();

    return NextResponse.json({
      answer: answer || "I could not generate a response for that yet.",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unexpected chat error.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
