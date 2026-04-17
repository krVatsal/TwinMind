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
  stream?: boolean;
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
        stream: Boolean(body.stream),
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

    if (body.stream) {
      if (!response.body) {
        return NextResponse.json({ error: "Streaming response body unavailable." }, { status: 500 });
      }

      return streamChatResponse(response.body);
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

function streamChatResponse(upstream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          processSseBuffer(buffer, controller, encoder, (remaining) => {
            buffer = remaining;
          });
        }

        if (buffer.trim()) {
          processSseLine(buffer.trim(), controller, encoder);
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function processSseBuffer(
  rawBuffer: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  setRemaining: (remaining: string) => void,
) {
  const lines = rawBuffer.split("\n");
  const remaining = lines.pop() ?? "";
  setRemaining(remaining);

  for (const line of lines) {
    processSseLine(line.trim(), controller, encoder);
  }
}

function processSseLine(
  line: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
) {
  if (!line.startsWith("data:")) {
    return;
  }

  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") {
    return;
  }

  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const token = payload.choices?.[0]?.delta?.content;
    if (token) {
      controller.enqueue(encoder.encode(token));
    }
  } catch {
    // Ignore malformed SSE chunks and continue streaming.
  }
}
