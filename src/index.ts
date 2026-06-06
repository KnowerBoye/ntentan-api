import express from "express" 
import dotenv from "dotenv"
import {Server} from "socket.io"
import {createServer} from "http"
import {handleVideoStreamConnection} from "@features/medication-scanner/medscanner.service"
import { handleAssistantSocket } from "./features/assistant/assistant.service"
import { socketAuthMiddleware } from "@middlewares/socket-auth.middleware";
import { globalErrorHandler, notFoundHandler } from "@middlewares/error-handler.middleware";
import { logger } from "@/lib/logger";

dotenv.config()

const app = express()
const server = createServer(app)

// ── Express global middleware ─────────────────
app.use(express.json());

// ── Socket.IO setup ──────────────────────────
const io = new Server(server)

// Apply Firebase JWT auth to all WebSocket namespaces
io.use(socketAuthMiddleware);

io.of("/assistant").on("connection" , handleAssistantSocket)
io.of("/med-scanner").on("connection" , handleVideoStreamConnection)

// ── Express routes would be registered here ──

// ── Express error handlers (must be AFTER all routes) ──
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ── Process-level error handlers ─────────────

/**
 * Handle uncaught exceptions — crash and restart on non-operational errors.
 */
process.on("uncaughtException", (err: Error) => {
  logger.fatal("UNCAUGHT EXCEPTION! Shutting down...", {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
  // Give the logger time to flush, then exit
  process.exit(1);
});

/**
 * Handle unhandled promise rejections — treat like an uncaught exception.
 */
process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal("UNHANDLED REJECTION! Shutting down...", {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

/**
 * Graceful shutdown on SIGTERM (e.g. Cloud Run, Kubernetes).
 */
process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    logger.info("HTTP server closed.");
    process.exit(0);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => logger.info(`Server running on ${PORT}`));