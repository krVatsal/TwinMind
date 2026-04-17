"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { DEFAULT_SETTINGS } from "@/lib/defaults";
import {
  AppSettings,
  ChatMessage,
  ExportPayload,
  SuggestionBatch,
  SuggestionCard,
  TranscriptChunk,
} from "@/types/domain";

const CHUNK_MS = 30_000;

export default function Home() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [statusLine, setStatusLine] = useState("Idle");
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [lastSuggestionLatencyMs, setLastSuggestionLatencyMs] = useState<number | null>(null);
  const [lastChatFirstTokenLatencyMs, setLastChatFirstTokenLatencyMs] = useState<number | null>(null);
  const [lastChatLatencyMs, setLastChatLatencyMs] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const chunkTimeoutRef = useRef<number | null>(null);
  const recordingActiveRef = useRef(false);
  const pendingFlushResolversRef = useRef<Array<() => void>>([]);

  const transcriptText = useMemo(
    () => transcript.map((chunk) => `[${formatClock(chunk.createdAt)}] ${chunk.text}`).join("\n"),
    [transcript],
  );

  useEffect(() => {
    if (!transcriptScrollRef.current) {
      return;
    }
    transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
  }, [transcript]);

  const appendTranscript = useCallback((text: string, createdAt: string) => {
    const cleaned = text.trim();
    if (!cleaned) {
      return;
    }

    setTranscript((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: cleaned,
        createdAt,
      },
    ]);
  }, []);

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      if (!settings.apiKey.trim()) {
        setStatusLine("Add Groq API key in settings first.");
        return;
      }

      const formData = new FormData();
      formData.append("audio", blob, buildAudioFileName(blob.type));
      formData.append("apiKey", settings.apiKey);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
          status?: number;
        };
        throw new Error(
          payload.detail ||
            payload.error ||
            `Transcription request failed${payload.status ? ` (${payload.status})` : ""}.`,
        );
      }

      const payload = (await response.json()) as { text: string; createdAt: string };
      appendTranscript(payload.text, payload.createdAt || new Date().toISOString());
    },
    [appendTranscript, settings.apiKey],
  );

  const stopMic = useCallback(() => {
    recordingActiveRef.current = false;

    if (chunkTimeoutRef.current !== null) {
      window.clearTimeout(chunkTimeoutRef.current);
      chunkTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setIsRecording(false);
    setStatusLine("Idle");
  }, []);

  const flushRecordingChunk = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    const chunkProcessed = new Promise<void>((resolve) => {
      pendingFlushResolversRef.current.push(resolve);
    });
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, 4000);
    });

    recorder.stop();
    await Promise.race([chunkProcessed, timeout]);
  }, []);

  const preferredMimeType = useCallback((): string | undefined => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];

    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return undefined;
  }, []);

  function startRecordingCycle(stream: MediaStream) {
    const mimeType = preferredMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data || event.data.size === 0) {
          const resolver = pendingFlushResolversRef.current.shift();
          resolver?.();
          return;
        }

        setStatusLine("Transcribing latest chunk...");
        void transcribeBlob(event.data)
          .then(() => {
            setStatusLine("Recording");
          })
          .catch((error: unknown) => {
            setStatusLine(error instanceof Error ? error.message : "Transcription error");
          })
          .finally(() => {
            const resolver = pendingFlushResolversRef.current.shift();
            resolver?.();
          });
      };

      recorder.onerror = () => {
        setStatusLine("Microphone recording error.");
      };

      recorder.onstop = () => {
        if (!recordingActiveRef.current) {
          return;
        }

        // Rotate the recorder so each chunk is a valid standalone media file.
        startRecordingCycle(stream);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;

    chunkTimeoutRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, CHUNK_MS);
  }

  const startMic = async () => {
    if (!settings.apiKey.trim()) {
      setStatusLine("Add Groq API key in settings before recording.");
      setIsSettingsOpen(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaStreamRef.current = stream;
      recordingActiveRef.current = true;
      startRecordingCycle(stream);
      setIsRecording(true);
      setStatusLine("Recording");
    } catch {
      setStatusLine("Mic permission denied or unavailable.");
    }
  };

  const refreshSuggestions = useCallback(
    async (source: "auto" | "manual") => {
      if (!settings.apiKey.trim()) {
        setStatusLine("Add Groq API key in settings first.");
        return;
      }

      const startedAt = performance.now();
      setIsReloading(true);
      setStatusLine(source === "manual" ? "Reloading suggestions..." : "Refreshing suggestions...");

      try {
        if (source === "manual") {
          await flushRecordingChunk();
        }

        const response = await fetch("/api/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            apiKey: settings.apiKey,
            transcriptText,
            prompt: settings.liveSuggestionPrompt,
            contextChars: settings.suggestionContextChars,
            temperature: settings.suggestionTemperature,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Suggestion refresh failed.");
        }

        const payload = (await response.json()) as {
          createdAt: string;
          suggestions: SuggestionCard[];
        };

        setSuggestionBatches((prev) => [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: payload.createdAt || new Date().toISOString(),
            suggestions: payload.suggestions,
          },
          ...prev,
        ]);
        const refreshLatency = Math.round(performance.now() - startedAt);
        setLastSuggestionLatencyMs(refreshLatency);
        console.info("suggestions_refresh_latency_ms", refreshLatency);
        setStatusLine("Suggestions updated.");
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : "Failed to update suggestions.");
      } finally {
        setIsReloading(false);
      }
    },
    [
      flushRecordingChunk,
      settings.apiKey,
      settings.liveSuggestionPrompt,
      settings.suggestionContextChars,
      settings.suggestionTemperature,
      transcriptText,
    ],
  );

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const interval = setInterval(() => {
      void refreshSuggestions("auto");
    }, Math.max(10, settings.refreshSeconds) * 1000);

    return () => clearInterval(interval);
  }, [isRecording, refreshSuggestions, settings.refreshSeconds]);

  const requestDetailedAnswer = useCallback(
    async (userPrompt: string, source: "manual" | "suggestion") => {
      const prompt = userPrompt.trim();
      if (!prompt || !settings.apiKey.trim()) {
        return;
      }

      const userMessage: ChatMessage = {
        id: `${Date.now()}-u`,
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
        source,
      };

      setChatHistory((prev) => [...prev, userMessage]);
      setIsAnswering(true);
      setStatusLine("Generating answer...");

      const startedAt = performance.now();
      const assistantMessageId = `${Date.now()}-a`;
      const assistantCreatedAt = new Date().toISOString();

      try {
        setChatHistory((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            createdAt: assistantCreatedAt,
            source: "assistant",
          },
        ]);

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            apiKey: settings.apiKey,
            transcriptText,
            contextChars:
              source === "suggestion" ? settings.expandedContextChars : settings.chatContextChars,
            temperature: settings.answerTemperature,
            systemPrompt:
              source === "suggestion" ? settings.expandedAnswerPrompt : settings.chatPrompt,
            userPrompt: prompt,
            stream: true,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Chat request failed.");
        }

        if (!response.body) {
          throw new Error("Streaming response body was empty.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let hasFirstToken = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) {
            continue;
          }

          accumulated += chunk;

          if (!hasFirstToken && chunk.trim()) {
            hasFirstToken = true;
            const firstTokenLatency = Math.round(performance.now() - startedAt);
            setLastChatFirstTokenLatencyMs(firstTokenLatency);
            console.info("chat_first_token_latency_ms", firstTokenLatency);
          }

          setChatHistory((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId ? { ...message, content: accumulated } : message,
            ),
          );
        }

        if (!accumulated.trim()) {
          const fallback = "I could not generate a response for that yet.";
          setChatHistory((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId ? { ...message, content: fallback } : message,
            ),
          );
        }

        const totalLatency = Math.round(performance.now() - startedAt);
        setLastChatLatencyMs(totalLatency);
        console.info("chat_total_latency_ms", totalLatency);
        setStatusLine("Answer ready.");
      } catch (error) {
        setChatHistory((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: "Failed to generate answer." }
              : message,
          ),
        );
        setStatusLine(error instanceof Error ? error.message : "Failed to generate answer.");
      } finally {
        setIsAnswering(false);
      }
    },
    [
      settings.apiKey,
      settings.answerTemperature,
      settings.chatContextChars,
      settings.chatPrompt,
      settings.expandedAnswerPrompt,
      settings.expandedContextChars,
      transcriptText,
    ],
  );

  const onSubmitChat = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const prompt = chatInput.trim();
      if (!prompt) {
        return;
      }
      setChatInput("");
      await requestDetailedAnswer(prompt, "manual");
    },
    [chatInput, requestDetailedAnswer],
  );

  const onSuggestionClick = useCallback(
    async (suggestion: SuggestionCard) => {
      await requestDetailedAnswer(`${suggestion.title}\n\n${suggestion.preview}`, "suggestion");
    },
    [requestDetailedAnswer],
  );

  const onExport = useCallback(() => {
    const payload: ExportPayload = {
      exportedAt: new Date().toISOString(),
      transcript,
      suggestionBatches,
      chatHistory,
    };

    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `twinmind-session-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [chatHistory, suggestionBatches, transcript]);

  return (
    <main className="tm-root">
      <header className="tm-header">
        <div>
          <h1>TwinMind - Live Suggestions Web App</h1>
          <p>3-column layout: Transcript, Suggestions, Chat</p>
        </div>
        <div className="tm-header-actions">
          <span className="tm-pill">Status: {statusLine}</span>
          <button onClick={() => setIsSettingsOpen((prev) => !prev)} className="tm-btn tm-btn-ghost">
            {isSettingsOpen ? "Close Settings" : "Settings"}
          </button>
          <button onClick={onExport} className="tm-btn tm-btn-primary">
            Export Session
          </button>
        </div>
      </header>

      {isSettingsOpen && (
        <section className="tm-settings">
          <h2>Settings</h2>
          <div className="tm-settings-grid">
            <label>
              Groq API Key
              <input
                type="password"
                value={settings.apiKey}
                onChange={(event) => setSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="gsk_..."
              />
            </label>
            <label>
              Refresh interval (seconds)
              <input
                type="number"
                min={10}
                max={120}
                value={settings.refreshSeconds}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    refreshSeconds: Number(event.target.value) || prev.refreshSeconds,
                  }))
                }
              />
            </label>
            <label>
              Suggestion context chars
              <input
                type="number"
                min={500}
                max={30000}
                value={settings.suggestionContextChars}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    suggestionContextChars:
                      Number(event.target.value) || prev.suggestionContextChars,
                  }))
                }
              />
            </label>
            <label>
              Expanded answer context chars
              <input
                type="number"
                min={1000}
                max={50000}
                value={settings.expandedContextChars}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    expandedContextChars:
                      Number(event.target.value) || prev.expandedContextChars,
                  }))
                }
              />
            </label>
            <label>
              Chat context chars
              <input
                type="number"
                min={500}
                max={50000}
                value={settings.chatContextChars}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    chatContextChars: Number(event.target.value) || prev.chatContextChars,
                  }))
                }
              />
            </label>
            <label>
              Suggestion temperature
              <input
                type="number"
                min={0}
                max={1.5}
                step={0.1}
                value={settings.suggestionTemperature}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    suggestionTemperature:
                      Number(event.target.value) || prev.suggestionTemperature,
                  }))
                }
              />
            </label>
            <label>
              Answer temperature
              <input
                type="number"
                min={0}
                max={1.5}
                step={0.1}
                value={settings.answerTemperature}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    answerTemperature: Number(event.target.value) || prev.answerTemperature,
                  }))
                }
              />
            </label>
          </div>
          <label>
            Live suggestions prompt
            <textarea
              value={settings.liveSuggestionPrompt}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, liveSuggestionPrompt: event.target.value }))
              }
            />
          </label>
          <label>
            Expanded answer prompt
            <textarea
              value={settings.expandedAnswerPrompt}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, expandedAnswerPrompt: event.target.value }))
              }
            />
          </label>
          <label>
            Chat prompt
            <textarea
              value={settings.chatPrompt}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, chatPrompt: event.target.value }))
              }
            />
          </label>
        </section>
      )}

      <section className="tm-panels">
        <article className="tm-panel">
          <div className="tm-panel-header">
            <h2>1. Mic & Transcript</h2>
            <span>{isRecording ? "Recording" : "Idle"}</span>
          </div>

          <div className="tm-controls">
            <button
              className={`tm-mic ${isRecording ? "is-live" : ""}`}
              onClick={isRecording ? stopMic : () => void startMic()}
            >
              {isRecording ? "Stop mic" : "Start mic"}
            </button>
            <p>Transcript appends approximately every 30 seconds while recording.</p>
          </div>

          <div ref={transcriptScrollRef} className="tm-transcript-box">
            {transcript.length === 0 ? (
              <p className="tm-empty">No transcript yet. Start the mic.</p>
            ) : (
              transcript.map((chunk) => (
                <p key={chunk.id}>
                  <span>[{formatClock(chunk.createdAt)}]</span> {chunk.text}
                </p>
              ))
            )}
          </div>
        </article>

        <article className="tm-panel">
          <div className="tm-panel-header">
            <h2>2. Live Suggestions</h2>
            <span>{suggestionBatches.length} batches</span>
          </div>

          <div className="tm-controls tm-row">
            <button
              className="tm-btn tm-btn-primary"
              disabled={isReloading}
              onClick={() => void refreshSuggestions("manual")}
            >
              {isReloading ? "Reloading..." : "Reload suggestions"}
            </button>
            <p>
              {lastSuggestionLatencyMs
                ? `Last refresh latency: ${lastSuggestionLatencyMs}ms`
                : `Auto-refresh every ${settings.refreshSeconds}s while recording.`}
            </p>
          </div>

          <div className="tm-suggestions-scroll">
            {suggestionBatches.length === 0 ? (
              <p className="tm-empty">Suggestions appear here once recording starts.</p>
            ) : (
              suggestionBatches.map((batch) => (
                <section className="tm-batch" key={batch.id}>
                  <div className="tm-batch-header">{formatClock(batch.createdAt)}</div>
                  <div className="tm-card-grid">
                    {batch.suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        className="tm-card"
                        onClick={() => void onSuggestionClick(suggestion)}
                      >
                        <span className="tm-kind">{suggestion.kind.replace("_", " ")}</span>
                        <h3>{suggestion.title}</h3>
                        <p>{suggestion.preview}</p>
                      </button>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </article>

        <article className="tm-panel">
          <div className="tm-panel-header">
            <h2>3. Chat (Detailed Answers)</h2>
            <span>Session only</span>
          </div>

          <div className="tm-chat-scroll">
            {chatHistory.length === 0 ? (
              <p className="tm-empty">Click a suggestion or type a question below.</p>
            ) : (
              chatHistory.map((message) => (
                <div key={message.id} className={`tm-msg tm-${message.role}`}>
                  <div className="tm-msg-meta">
                    <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
                    <span>{formatClock(message.createdAt)}</span>
                  </div>
                  <ChatMessageContent content={message.content} />
                </div>
              ))
            )}
          </div>

          <form className="tm-chat-form" onSubmit={onSubmitChat}>
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask anything..."
            />
            <button className="tm-btn tm-btn-primary" type="submit" disabled={isAnswering}>
              {isAnswering ? "Sending..." : "Send"}
            </button>
          </form>
          <p className="tm-latency">
            {lastChatLatencyMs
              ? `Last chat latency: first token ${lastChatFirstTokenLatencyMs ?? "-"}ms, completed ${lastChatLatencyMs}ms`
              : "No chat answer yet."}
          </p>
        </article>
      </section>
    </main>
  );
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ChatMessageContent({ content }: { content: string }) {
  return (
    <div className="tm-msg-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function buildAudioFileName(mimeType: string): string {
  const type = mimeType.toLowerCase();

  if (type.includes("ogg")) {
    return "chunk.ogg";
  }
  if (type.includes("mp4") || type.includes("m4a")) {
    return "chunk.m4a";
  }
  if (type.includes("wav")) {
    return "chunk.wav";
  }
  if (type.includes("mpeg") || type.includes("mp3")) {
    return "chunk.mp3";
  }
  return "chunk.webm";
}
