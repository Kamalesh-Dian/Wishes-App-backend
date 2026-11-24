import type {
  Request,
  Response,
  NextFunction,
} from "express";

import {firebaseAuth} from "../config/firebase";

export interface AuthRequest
  extends Request {
  user?: {
    uid: string;
    email?: string;
  };
}

export const auth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const header =
      req.headers.authorization;

    if (!header) {
      return res.status(401).json({
        message: "No token provided",
      });
    }

    const token =
      header.replace(
        "Bearer ",
        "",
      );

    if (token.startsWith("demo_token_")) {
      if (process.env.ENABLE_DEMO_ACCOUNTS !== "true") {
        return res.status(401).json({
          message: "Demo accounts are disabled",
        });
      }
      const tier = token.replace("demo_token_", "").toLowerCase();
      const validTier = tier === "pro" ? "pro" : tier === "ultimate" || tier === "enterprise" ? "ultimate" : "free";
      req.user = {
        uid: `demo_uid_${validTier}`,
        email: `${validTier}@wishes.ai`,
      };
      return next();
    }

   const decoded = await firebaseAuth.verifyIdToken(token);

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
    };

    next();
  } catch{
    return res.status(401).json({
      message: "Unauthorized",
    });
  }
};