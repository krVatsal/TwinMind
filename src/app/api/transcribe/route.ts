import { NextResponse } from "next/server";

import { TRANSCRIBE_MODEL } from "@/lib/defaults";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TRANSCRIBE_FALLBACK_MODEL = "whisper-large-v3-turbo";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const apiKeyRaw = formData.get("apiKey");

    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
    }

    if (typeof apiKeyRaw !== "string" || apiKeyRaw.trim().length === 0) {
      return NextResponse.json({ error: "Missing Groq API key." }, { status: 400 });
    }

    const fileName =
      audio instanceof File && audio.name ? audio.name : fileNameFromMime(audio.type || "");

    const firstAttempt = await transcribeWithModel({
      audio,
      fileName,
      apiKey: apiKeyRaw.trim(),
      model: TRANSCRIBE_MODEL,
    });

    let finalAttempt = firstAttempt;

    if (!firstAttempt.ok && firstAttempt.status === 400) {
      finalAttempt = await transcribeWithModel({
        audio,
        fileName,
        apiKey: apiKeyRaw.trim(),
        model: TRANSCRIBE_FALLBACK_MODEL,
      });
    }

    if (!finalAttempt.ok) {
      return NextResponse.json(
        {
          error: "Transcription failed.",
          detail: finalAttempt.errorDetail,
          status: finalAttempt.status,
          model: finalAttempt.model,
          fileName,
        },
        { status: finalAttempt.status || 500 },
      );
    }

    const payload = finalAttempt.payload as {
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

async function transcribeWithModel(input: {
  audio: Blob;
  fileName: string;
  apiKey: string;
  model: string;
}): Promise<{
  ok: boolean;
  status: number;
  payload?: unknown;
  errorDetail?: string;
  model: string;
}> {
  const upstreamForm = new FormData();
  upstreamForm.append("file", input.audio, input.fileName);
  upstreamForm.append("model", input.model);
  upstreamForm.append("response_format", "verbose_json");
  upstreamForm.append("temperature", "0");
  upstreamForm.append("language", "en");

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: upstreamForm,
  });

  if (!response.ok) {
    const detail = await response.text();
    const parsed = tryParseJson(detail);
    const upstreamMessage =
      typeof parsed?.error?.message === "string"
        ? parsed.error.message
        : detail || "Unknown transcription error from Groq.";

    return {
      ok: false,
      status: response.status,
      errorDetail: upstreamMessage,
      model: input.model,
    };
  }

  return {
    ok: true,
    status: response.status,
    payload: await response.json(),
    model: input.model,
  };
}

function fileNameFromMime(mimeType: string): string {
  const type = mimeType.toLowerCase();

  if (type.includes("ogg")) {
    return "audio.ogg";
  }
  if (type.includes("mp4") || type.includes("m4a")) {
    return "audio.m4a";
  }
  if (type.includes("wav")) {
    return "audio.wav";
  }
  if (type.includes("mpeg") || type.includes("mp3")) {
    return "audio.mp3";
  }
  return "audio.webm";
}

function tryParseJson(raw: string): {
  error?: {
    message?: string;
  };
} | null {
  try {
    return JSON.parse(raw) as {
      error?: {
        message?: string;
      };
    };
  } catch {
    return null;
  }
}
