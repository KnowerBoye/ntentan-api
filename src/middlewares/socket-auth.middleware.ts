// ─────────────────────────────────────────────
//  middlewares/socket-auth.middleware.ts
//  Socket.IO middleware – Firebase JWT verification
// ─────────────────────────────────────────────
import { Socket } from "socket.io";
import * as admin from "firebase-admin/auth";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Extend the Socket type so downstream handlers can access the verified user
declare module "socket.io" {
  interface Socket {
    user?: {
      uid: string;
      email?: string;
      phone_number?: string;
      name?: string;
      picture?: string;
    };
  }
}

/**
 * Socket.IO middleware that verifies a Firebase JWT token.
 *
 * The client MUST send the token via one of:
 *  - `auth.token` in the handshake auth object
 *  - `token` query parameter in the connection URL
 *
 * On success the decoded user payload is attached to `socket.user`.
 * On failure the connection is rejected with an error.
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {

    // 1. Extract token from handshake auth or query string
    const token =
      socket.handshake.auth?.token ??
      (socket.handshake.query?.token as string | undefined);



    if (!token) {
      logger.warn("Socket auth rejected: no token provided", {
        socketId: socket.id,
      });
      return next(new UnauthorizedError("Authentication required: no token provided"));
    }

    // 2. Verify the Firebase ID token
    const decoded = await admin.getAuth().verifyIdToken(token);



    // 3. Attach verified user to the socket
    socket.user = {
      uid: decoded.uid,
      email: decoded.email,
      phone_number: decoded.firebase?.phone_number,
      name: decoded.name,
      picture: decoded.picture,
    };

    // logger.info("Socket authenticated", {
    //   socketId: socket.id,
    //   uid: decoded.uid,
    // });

    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Socket auth failed", { socketId: socket.id, message });
    next(new UnauthorizedError(`Authentication failed: ${message}`));
  }
}
