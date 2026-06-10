import { Router } from "express";
import { authMiddleware } from "@middlewares/auth.middleware";
import validate from "@middlewares/validator.middleware";
import { asyncHandler } from "@middlewares/error-handler.middleware";
import { QueryAgentSchema } from "@features/assistant/assistant.schema";
import { handleAssistantChat } from "@features/assistant/assistant.service";
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


    logger.debug(result.toString())
    res.json({
      status: "success",
      data: result,
    });
  })
);

export default router;