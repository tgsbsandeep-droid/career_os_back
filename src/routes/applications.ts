import express = require("express");
const { createAuthenticatedClient, getUserFromToken, hasAnyRole } = require("../lib/supabase");

const router = express.Router();
const statuses = ["applied", "shortlisted", "interview", "hired", "rejected"];

router.patch("/:id/status", async (req, res) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
  const currentUser = await getUserFromToken(token);
  if (!currentUser || !hasAnyRole(currentUser, ["recruiter", "employer"])) return res.status(403).json({ success: false, message: "Recruiter or employer access required" });
  if (!statuses.includes(req.body.status)) return res.status(400).json({ success: false, message: "Invalid application status" });

  const client = createAuthenticatedClient(token);
  const { data: application } = await client.from("applications").select("id, job_id").eq("id", req.params.id).maybeSingle();
  if (!application) return res.status(404).json({ success: false, message: "Application not found" });
  const { data: job } = await client
    .from("jobs")
    .select("id, owner_id, employer_id, recruiter_id")
    .eq("id", application.job_id)
    .maybeSingle();
  const ownsByUser = job && (job.owner_id === currentUser.id || job.employer_id === currentUser.id);
  const { data: rp } = ownsByUser
    ? { data: null }
    : await client.from("recruiter_profiles").select("id").eq("user_id", currentUser.id).maybeSingle();
  const recruiterId = rp?.id ?? (await client.from("recruiter_profiles").select("id").eq("id", currentUser.id).maybeSingle()).data?.id ?? null;
  if (!job || (!ownsByUser && !(recruiterId && job.recruiter_id === recruiterId))) {
    return res.status(403).json({ success: false, message: "You do not manage this application" });
  }

  const { data, error } = await client.from("applications").update({ status: req.body.status, updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, application: data });
});

export = router;
