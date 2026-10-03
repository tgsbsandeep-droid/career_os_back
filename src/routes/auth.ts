/**
 * /api/auth — Auth endpoints that proxy Supabase auth operations.
 * Frontend calls these instead of hitting Supabase directly, so the
 * Supabase service-role key and JWT secret never need to be in the browser.
 *
 * POST /api/auth/signup   — create account
 * POST /api/auth/login    — email + password sign-in
 * POST /api/auth/logout   — sign out (invalidates refresh token server-side)
 * GET  /api/auth/session  — return current user from Bearer JWT
 * POST /api/auth/refresh  — exchange refresh_token for new access_token
 */

import express = require("express");
import type { Request, Response } from "express";
const { supabase, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// Body: { email, password, full_name, role }
// ---------------------------------------------------------------------------
router.post("/signup", async (req: Request, res: Response) => {
  const { email, password, full_name, role, roles, active_role } = req.body as {
    email?: string;
    password?: string;
    full_name?: string;
    role?: string;
    roles?: string[];
    active_role?: string;
  };

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
  }

  const selectedRole = role ?? "candidate";
  const selectedRoles = roles ?? [selectedRole];
  const selectedActiveRole = active_role ?? selectedRole;

  const { data, error } = await supabase.auth.signUp({
    email: String(email).trim(),
    password,
    options: {
      data: {
        full_name: String(full_name ?? "").trim(),
        role: selectedRole,
        roles: selectedRoles,
        active_role: selectedActiveRole,
      },
    },
  });

  if (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  return res.json({
    success: true,
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email,
          user_metadata: data.user.user_metadata,
        }
      : null,
    session: data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          token_type: data.session.token_type,
        }
      : null,
    email_confirmation_required: !data.session,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Body: { email, password }
// ---------------------------------------------------------------------------
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email).trim(),
    password,
  });

  if (error) {
    return res.status(401).json({ success: false, message: error.message });
  }

  return res.json({
    success: true,
    user: {
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
      app_metadata: data.user.app_metadata,
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// Header: Authorization: Bearer <access_token>
// ---------------------------------------------------------------------------
router.post("/logout", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided." });
  }

  // Sign out using the user's token — this invalidates the session server-side.
  const { error } = await supabase.auth.admin
    ? await supabase.auth.signOut()
    : { error: null };

  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }

  return res.json({ success: true, message: "Signed out successfully." });
});

// ---------------------------------------------------------------------------
// GET /api/auth/session
// Header: Authorization: Bearer <access_token>
// Returns the user associated with the JWT.
// ---------------------------------------------------------------------------
router.get("/session", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided." });
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }

  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata,
      app_metadata: user.app_metadata,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// Body: { refresh_token }
// Returns new access_token + refresh_token pair.
// ---------------------------------------------------------------------------
router.post("/refresh", async (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (!refresh_token) {
    return res.status(400).json({ success: false, message: "refresh_token is required." });
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    return res.status(401).json({ success: false, message: error?.message ?? "Session refresh failed." });
  }

  return res.json({
    success: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
    },
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email,
          user_metadata: data.user.user_metadata,
          app_metadata: data.user.app_metadata,
        }
      : null,
  });
});

module.exports = router;
