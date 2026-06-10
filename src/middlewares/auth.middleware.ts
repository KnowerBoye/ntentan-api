// ─────────────────────────────────────────────
//  middlewares/auth.middleware.ts
//  Express middleware – Firebase JWT verification
// ─────────────────────────────────────────────
import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin/auth";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Express middleware that verifies a Firebase JWT token from the
 * `Authorization: Bearer <token>` header.
 *
 * On success the decoded user payload is attached to `req.user`.
 * On failure a 401 UnauthorizedError is passed to the error handler.
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Auth rejected: no Bearer token provided", {
        path: req.path,
        method: req.method,
      });
      return next(new UnauthorizedError("Authentication required: no token provided"));
    }

    const token = authHeader.split(" ")[1].trim(); 


    // 2. Verify the Firebase ID token
    const decoded = await admin.getAuth().verifyIdToken(token);

    // 3. Attach verified user to the request
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: decoded.name ?? null,
      picture: decoded.picture ?? null,
    };

    logger.debug("Request authenticated", {
      uid: decoded.uid,
      path: req.path,
    });

    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Auth failed", { path: req.path, message });
    next(new UnauthorizedError(`Authentication failed: ${message}`));
  }
}