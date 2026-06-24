import { describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { extractAuthToken, getCapabilitiesForRoles } from "../src/middleware/auth.js";

describe("auth helpers", () => {
  it("prefers bearer token over cookie token", () => {
    expect(extractAuthToken("Bearer bearer-token", { auth_token: "cookie-token" })).toBe("bearer-token");
  });

  it("uses auth_token cookie when authorization is missing", () => {
    expect(extractAuthToken(undefined, { auth_token: "cookie-token" })).toBe("cookie-token");
  });

  it("returns empty token when both sources are missing", () => {
    expect(extractAuthToken(undefined, {})).toBe("");
  });

  it("maps roles to capabilities", () => {
    expect(getCapabilitiesForRoles(["worker"]).canViewAdmin).toBe(false);
    expect(getCapabilitiesForRoles(["leader"]).canImportOperations).toBe(true);
    expect(getCapabilitiesForRoles(["admin"]).canForceRemoveAssignments).toBe(true);
  });

  it("loads mock token settings from env/defaults", () => {
    expect(typeof config.allowMockToken).toBe("boolean");
    expect(config.mockAuthToken).toBe("mock-token");
  });
});
