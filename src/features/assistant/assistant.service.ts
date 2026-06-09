import { ChatMessage, UserMessage } from "@/types/assistant";
import { MedicalAssistant } from "@features/assistant/assistant";
import { handleTwiAudio, twiToEnglish } from "./voice.service";
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
  toolsUsed: string[];
  sources?: string[];
  history: ChatMessage[];
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

  // ── 3. Build updated history ──
  const updatedHistory: ChatMessage[] = [
    ...history,
    {
      ...preparedQuery,
      role: "user",
    },
    {
      content: response.message,
      role: "assistant",
      language: "english",
      type: "text",
    },
  ];

  return {
    message: response.message,
    toolsUsed: response.toolsUsed,
    sources: response.sources,
    history: updatedHistory,
  };
}