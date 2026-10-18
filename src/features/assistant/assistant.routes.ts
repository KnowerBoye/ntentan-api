import { Router } from "express";
import { authMiddleware } from "@middlewares/auth.middleware";
import validate from "@middlewares/validator.middleware";
import { asyncHandler } from "@middlewares/error-handler.middleware";
import { QueryAgentSchema } from "@features/assistant/assistant.schema";
import { handleAssistantChat, handleAssistantChatStream } from "@features/assistant/assistant.service";
import { ChatMessage, UserMessage } from "@/types/assistant";
import { logger } from "@/lib/logger";

const router = Router();

/**
 * POST /api/assistant/chat
 *
 * Send a message to the medical assistant and receive a response.
 * The client owns the conversation history and sends it with each request.
 *
 * Body:
 *   query    – { content: string, type: "text" | "audio" }
 *   history  – Array of previous ChatMessages (optional, default [])
 *   language – "english" | "twi"
 *
 * Headers:
 *   Authorization: Bearer <Firebase ID token>
 */
router.post(
  "/chat",
  authMiddleware,
  validate(QueryAgentSchema),
  asyncHandler(async (req, res) => {
    const { query, history, language } = req.validated!.body as {
      query: { content: string; type: "text" | "audio" };
      history: ChatMessage[];
      language: "english" | "twi";
    };

    const userId = req.user!.uid;

    const userMessage: UserMessage = {
      content: query.content,
      type: query.type,
      language,
    };

    const result = await handleAssistantChat(userMessage, userId, history);


    logger.debug("Assistant chat completed", { toolsUsed: result.history.length });
    res.json({
      status: "success",
      data: result,
    });
  })
);

/**
 * POST /api/assistant/chat/stream
 *
 * Streaming (SSE) variant of /chat. Same body + auth. Emits events:
 *   event: tool  → { name }            tool call dispatched (UI status)
 *   event: delta → { text }            incremental answer text
 *   event: done  → { message, history, toolsUsed, sources?, audio? }
 *   event: error → { message }
 *
 * English requests stream token-by-token; Twi requests emit the translated
 * text as one delta immediately before `done` (plus synthesised audio).
 */
router.post(
  "/chat/stream",
  authMiddleware,
  validate(QueryAgentSchema),
  asyncHandler(async (req, res) => {
    const { query, history, language } = req.validated!.body as {
      query: { content: string; type: "text" | "audio" };
      history: ChatMessage[];
      language: "english" | "twi";
    };

    const userId = req.user!.uid;
    const userMessage: UserMessage = { content: query.content, type: query.type, language };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let clientClosed = false;
    req.on("close", () => { clientClosed = true; });

    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      for await (const ev of handleAssistantChatStream(userMessage, userId, history)) {
        if (clientClosed) break;
        send(ev.event, ev.data);
      }
    } catch (err) {
      logger.error("Assistant stream failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!clientClosed) send("error", { message: "Assistant failed to complete the response." });
    } finally {
      res.end();
    }
  })
);

export default router;