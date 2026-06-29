import { describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { generateLocalToken, verifyLocalToken } from "../src/lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles } from "../src/middleware/auth.js";
import { loadWecomAuthClients } from "../src/modules/auth/wecom.js";

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
    expect(getCapabilitiesForRoles(["worker"])).toEqual({
      roles: ["worker"],
      canViewAdmin: false,
      canAssignWorkers: false,
      canReviewExceptions: false,
      canImportOperations: false,
      canViewTeamOperations: false,
      canForceRemoveAssignments: false,
      canViewAllTeams: false
    });
    expect(getCapabilitiesForRoles(["leader"])).toMatchObject({
      canViewAdmin: true,
      canAssignWorkers: false,
      canReviewExceptions: true,
      canImportOperations: true,
      canViewTeamOperations: true,
      canForceRemoveAssignments: false,
      canViewAllTeams: false
    });
    expect(getCapabilitiesForRoles(["admin"])).toMatchObject({
      canAssignWorkers: true,
      canForceRemoveAssignments: true,
      canViewAllTeams: true
    });
  });

  it("loads mock token settings from env/defaults", () => {
    expect(typeof config.allowMockToken).toBe("boolean");
    expect(config.mockAuthToken).toBe("mock-token");
  });

  it("verifies locally issued auth tokens", () => {
    const token = generateLocalToken({
      userId: "worker-1",
      clientId: "new-frontend",
      name: "张师傅",
      avatar: null
    });

    expect(verifyLocalToken(token, ["new-frontend"])).toMatchObject({
      userId: "worker-1",
      sub: "worker-1",
      clientId: "new-frontend",
      name: "张师傅",
      avatar: null
    });
    expect(verifyLocalToken(token, ["legacy-frontend"])).toBeNull();
  });

  it("loads WeCom auth clients from env JSON", () => {
    const clients = loadWecomAuthClients(
      {
        WECHAT_AUTH_CLIENTS: JSON.stringify([
          {
            corpId: "ww-test",
            name: "test-corp",
            apps: [
              {
                agentId: 1000001,
                corpSecret: "secret",
                name: "frontend",
                clientId: "new-frontend",
                allowedOrigins: ["https://app.example.com"],
                scopes: ["profile:read"]
              }
            ]
          }
        ])
      } as NodeJS.ProcessEnv,
      "C:\\does-not-exist"
    );

    expect(clients).toEqual([
      expect.objectContaining({
        clientId: "new-frontend",
        corpId: "ww-test",
        corpName: "test-corp",
        agentId: 1000001,
        appName: "frontend",
        corpSecret: "secret",
        allowedOrigins: ["https://app.example.com"],
        scopes: ["profile:read"]
      })
    ]);
  });
});
