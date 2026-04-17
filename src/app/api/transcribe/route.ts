import { NextResponse } from "next/server";

import { TRANSCRIBE_MODEL } from "@/lib/defaults";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const apiKeyRaw = formData.get("apiKey");

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
    }

    if (typeof apiKeyRaw !== "string" || apiKeyRaw.trim().length === 0) {
      return NextResponse.json({ error: "Missing Groq API key." }, { status: 400 });
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", audio, audio.name || "audio.webm");
    upstreamForm.append("model", TRANSCRIBE_MODEL);
    upstreamForm.append("response_format", "verbose_json");

    const response = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKeyRaw.trim()}`,
      },
      body: upstreamForm,
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: "Transcription failed.", detail },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as {
      text?: string;
    };

    return NextResponse.json({
      text: payload.text ?? "",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unexpected transcription error.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
