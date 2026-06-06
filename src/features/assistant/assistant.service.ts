import { ChatMessage, UserMessage } from "@/types/assistant";
import { MedicalAssistant } from "@features/assistant/assistant";
import dotenv from "dotenv"
import { Socket } from "socket.io";
import { handleTwiAudio, twiToEnglish } from "./voice.service";
import { logger } from "@/lib/logger";
import { ExternalServiceError } from "@/lib/errors";
import { emitSocketError } from "@/lib/socket-error-handler";

dotenv.config()

export async function getAgentResponse(
  input: {
    content: string | Buffer,
    type: "text" | "audio"
  }
) {
  const assistant = new MedicalAssistant(process.env.GEMINI_API_KEY || "");
  // TODO: implement full getAgentResponse when the feature is ready
  logger.warn("getAgentResponse called but not fully implemented", { inputType: input.type });
}


export async function handleAssistantSocket(clientWs: Socket) {
  logger.info("Assistant socket connected", { socketId: clientWs.id });

  // temp store history in memory for mvp — move to memory store or db later
  const history: ChatMessage[] = [];

  const assistant = new MedicalAssistant(process.env.GEMINI_API_KEY || "");

  clientWs.on("message", async (message: UserMessage) => {
    try {
      const query: UserMessage = {
        type: "text",
        content: "",
        language: message.language,
      };

      if (message.type === "audio") {
        if (message.language === "twi") {
          query.type = "text";
          query.content = await handleTwiAudio(message.content);
        } else {
          query.type = "audio";
          query.content = message.content;
        }
      } else {
        if (message.language === "twi") {
          query.content = await twiToEnglish(message.content);
        } else {
          query.content = message.content;
        }
        query.type = "text";
      }

      logger.debug("Assistant query prepared", { query });

      const response = await assistant.chat(query, "uid", history);

      history.push({
        ...query,
        role: "user",
      });

      history.push({
        content: response.message,
        role: "assistant",
        language: "english",
        type: "text",
      });

      if (clientWs.connected) {
        clientWs.emit("response", response);
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));

      // Determine if this is an external (Gemini) error
      if (
        error.message?.includes("Gemini") ||
        error.message?.includes("API key") ||
        error.message?.includes("quota")
      ) {
        logger.error("Gemini API error in assistant chat", {
          socketId: clientWs.id,
          message: error.message,
        });
        emitSocketError(
          clientWs,
          new ExternalServiceError("Gemini API", error.message),
          "error"
        );
      } else {
        logger.error("Unexpected error in assistant chat", {
          socketId: clientWs.id,
          message: error.message,
          stack: error.stack,
        });
        emitSocketError(clientWs, error, "error");
      }

      // Disconnect on any error — the client must reconnect to retry
      if (clientWs.connected) {
        clientWs.disconnect(true);
      }
      history.length = 0;
    }
  });

  clientWs.on("disconnect", () => {
    logger.info("Assistant socket disconnected", { socketId: clientWs.id });
    history.length = 0;
  });
}