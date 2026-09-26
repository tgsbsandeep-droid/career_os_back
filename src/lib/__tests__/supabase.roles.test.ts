/**
 * Unit tests for collectRoles() and hasAnyRole() from lib/roles.ts.
 *
 * These functions are the local-dev fallback for role gating (the authoritative
 * check is verifyRoleFromDb()). They are pure (no I/O) so they are ideal
 * first candidates for unit coverage.
 *
 * Run with: npm test
 */

import { describe, it, expect } from "vitest";
import { collectRoles, hasAnyRole } from "../roles";

// ---------------------------------------------------------------------------
// collectRoles
// ---------------------------------------------------------------------------

describe("collectRoles", () => {
  it("returns an empty set for null", () => {
    expect(collectRoles(null).size).toBe(0);
  });

  it("returns an empty set for undefined", () => {
    expect(collectRoles(undefined).size).toBe(0);
  });

  it("returns an empty set when app_metadata is absent", () => {
    expect(collectRoles({}).size).toBe(0);
  });

  it("picks up a single role from app_metadata.role", () => {
    const roles = collectRoles({ app_metadata: { role: "candidate" } });
    expect(roles.has("candidate")).toBe(true);
  });

  it("picks up roles from app_metadata.roles array", () => {
    const roles = collectRoles({ app_metadata: { roles: ["recruiter", "admin"] } });
    expect(roles.has("recruiter")).toBe(true);
    expect(roles.has("admin")).toBe(true);
  });

  it("normalises to lowercase", () => {
    const roles = collectRoles({ app_metadata: { role: "CANDIDATE" } });
    expect(roles.has("candidate")).toBe(true);
  });

  it("expands alias: employer → recruiter", () => {
    const roles = collectRoles({ app_metadata: { role: "employer" } });
    expect(roles.has("recruiter")).toBe(true);
  });

  it("expands alias: tutor → academy", () => {
    const roles = collectRoles({ app_metadata: { role: "tutor" } });
    expect(roles.has("academy")).toBe(true);
  });

  it("expands alias: instructor → academy", () => {
    const roles = collectRoles({ app_metadata: { role: "instructor" } });
    expect(roles.has("academy")).toBe(true);
  });

  it("expands alias: student → candidate", () => {
    const roles = collectRoles({ app_metadata: { role: "student" } });
    expect(roles.has("candidate")).toBe(true);
  });

  it("ignores user_metadata entirely (not trusted for role gating)", () => {
    const roles = collectRoles({ user_metadata: { role: "admin" }, app_metadata: {} });
    expect(roles.has("admin")).toBe(false);
  });

  it("deduplicates when role and roles array overlap", () => {
    const roles = collectRoles({ app_metadata: { role: "recruiter", roles: ["recruiter"] } });
    expect(roles.has("recruiter")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasAnyRole
// ---------------------------------------------------------------------------

describe("hasAnyRole", () => {
  it("returns false for null user", () => {
    expect(hasAnyRole(null, ["candidate"])).toBe(false);
  });

  it("returns false when user has no matching role", () => {
    const user = { app_metadata: { role: "candidate" } };
    expect(hasAnyRole(user, ["admin"])).toBe(false);
  });

  it("returns true when user has an exact matching role", () => {
    const user = { app_metadata: { role: "admin" } };
    expect(hasAnyRole(user, ["admin"])).toBe(true);
  });

  it("returns true when one of multiple allowed roles matches", () => {
    const user = { app_metadata: { role: "recruiter" } };
    expect(hasAnyRole(user, ["recruiter", "employer"])).toBe(true);
  });

  it("returns true via alias: employer user satisfies recruiter gate", () => {
    const user = { app_metadata: { role: "employer" } };
    expect(hasAnyRole(user, ["recruiter"])).toBe(true);
  });

  it("returns true via alias: tutor user satisfies academy gate", () => {
    const user = { app_metadata: { role: "tutor" } };
    expect(hasAnyRole(user, ["academy"])).toBe(true);
  });

  it("is case-insensitive on the allowed list", () => {
    const user = { app_metadata: { role: "admin" } };
    expect(hasAnyRole(user, ["ADMIN"])).toBe(true);
  });

  it("returns false for empty allowed list", () => {
    const user = { app_metadata: { role: "admin" } };
    expect(hasAnyRole(user, [])).toBe(false);
  });
});