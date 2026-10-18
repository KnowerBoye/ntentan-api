import { ChatMessage, UserMessage, SupportedLanguage } from "@/types/assistant";
import { MedicalAssistant } from "@features/assistant/assistant";
import { handleTwiAudio, twiToEnglish, englishToTwi, twiTTS } from "./voice.service";
import { logger } from "@/lib/logger";
import dotenv from "dotenv"

dotenv.config()

/**
 * Handle an assistant chat request via HTTP.
 *
 * This is the Express route handler (called from assistant.routes.ts).
 * It processes the user query (text/audio, English/Twi), calls the
 * MedicalAssistant, and returns the response with updated history.
 */
export async function handleAssistantChat(
  query: UserMessage,
  userId: string,
  history: ChatMessage[]
): Promise<{
  message: string;
  history: ChatMessage[];
  audio?: string;
}> {
  const assistant = new MedicalAssistant(process.env.GEMINI_API_KEY || "");

  // ── 1. Prepare the query (audio transcription / Twi translation) ──
  const preparedQuery: UserMessage = {
    type: "text",
    content: "",
    language: query.language,
  };

  if (query.type === "audio") {
    if (query.language === "twi") {
      preparedQuery.type = "text";
      preparedQuery.content = await handleTwiAudio(query.content);
    } else {
      preparedQuery.type = "audio";
      preparedQuery.content = query.content;
    }
  } else {
    if (query.language === "twi") {
      preparedQuery.content = await twiToEnglish(query.content);
    } else {
      preparedQuery.content = query.content;
    }
    preparedQuery.type = "text";
  }

  logger.debug("Assistant query prepared", { query: preparedQuery });

  // ── 2. Get response from Gemini ──
  const response = await assistant.chat(preparedQuery, userId, history);

  // ── 3. Translate response to Twi if original query was in Twi ──
  let finalMessage = response.message;
  let responseLanguage: SupportedLanguage = "english";
  let audioBuffer: Buffer | undefined;

  if (query.language === "twi") {
    finalMessage = await englishToTwi(response.message);
    responseLanguage = "twi";
    audioBuffer = await twiTTS(finalMessage);
  }

  // ── 4. Build updated history ──
  const updatedHistory: ChatMessage[] = [
    ...history,
    {
      ...preparedQuery,
      role: "user",
    },
    {
      content: finalMessage,
      role: "assistant",
      language: responseLanguage,
      type: "text",
    },
  ];

  return {
    message: finalMessage,
    history: updatedHistory,
    ...(audioBuffer && { audio: audioBuffer.toString("base64") }),
  };
}

/** A single Server-Sent Event: an event name + JSON-serialisable payload. */
export interface AssistantSSEEvent {
  event: "tool" | "delta" | "done" | "error";
  data: unknown;
}

/**
 * Streaming variant of {@link handleAssistantChat} (SSE).
 *
 * Emits `tool` and `delta` events as the agent works, then a terminal `done`
 * event with the full message, updated history, and (for Twi) audio.
 *
 * English requests stream token deltas live. Twi requests cannot stream
 * token-by-token (the whole English answer must be translated + synthesised
 * first), so their deltas are suppressed and the translated text is emitted as
 * a single delta immediately before `done`.
 */
export async function* handleAssistantChatStream(
  query: UserMessage,
  userId: string,
  history: ChatMessage[]
): AsyncGenerator<AssistantSSEEvent> {
  const assistant = new MedicalAssistant(process.env.GEMINI_API_KEY || "");
  const isTwi = query.language === "twi";

  // ── 1. Prepare the query (same routing as the non-streaming path) ──
  const preparedQuery: UserMessage = {
    type: "text",
    content: "",
    language: query.language,
  };

  if (query.type === "audio") {
    if (query.language === "twi") {
      preparedQuery.type = "text";
      preparedQuery.content = await handleTwiAudio(query.content);
    } else {
      preparedQuery.type = "audio";
      preparedQuery.content = query.content;
    }
  } else {
    preparedQuery.content =
      query.language === "twi" ? await twiToEnglish(query.content) : query.content;
    preparedQuery.type = "text";
  }

  // ── 2. Stream the agent loop ──
  for await (const ev of assistant.chatStream(preparedQuery, userId, history)) {
    if (ev.type === "tool") {
      yield { event: "tool", data: { name: ev.name } };
      continue;
    }

    if (ev.type === "delta") {
      // English streams live; Twi deltas are English tokens — not useful.
      if (!isTwi) yield { event: "delta", data: { text: ev.text } };
      continue;
    }

    // ev.type === "final"
    let finalMessage = ev.message;
    let responseLanguage: SupportedLanguage = "english";
    let audioBuffer: Buffer | undefined;

    if (isTwi) {
      finalMessage = await englishToTwi(ev.message);
      responseLanguage = "twi";
      audioBuffer = await twiTTS(finalMessage);
      // Surface the translated text now (Twi had no live deltas).
      yield { event: "delta", data: { text: finalMessage } };
    }

    const updatedHistory: ChatMessage[] = [
      ...history,
      { ...preparedQuery, role: "user" },
      { content: finalMessage, role: "assistant", language: responseLanguage, type: "text" },
    ];

    yield {
      event: "done",
      data: {
        message: finalMessage,
        history: updatedHistory,
        toolsUsed: ev.toolsUsed,
        ...(ev.sources && { sources: ev.sources }),
        ...(audioBuffer && { audio: audioBuffer.toString("base64") }),
      },
    };
  }
}