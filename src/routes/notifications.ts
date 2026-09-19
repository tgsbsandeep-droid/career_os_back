import express = require("express");
const { createAuthenticatedClient, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

async function getClient(req: express.Request, res: express.Response) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token) };
}

router.get("/", async (req, res) => {
  const auth = await getClient(req, res);
  if (!auth) return;
  const { data, error } = await auth.client.from("notifications").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(30);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, notifications: data });
});

router.patch("/:id/read", async (req, res) => {
  const auth = await getClient(req, res);
  if (!auth) return;
  const { data, error } = await auth.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", req.params.id).eq("user_id", auth.user.id).select().single();
  if (error) return res.status(404).json({ success: false, message: "Notification not found" });
  return res.json({ success: true, notification: data });
});

export = router;
