import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/lib/config.js";
import { generateLocalToken, verifyLocalToken } from "../src/lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles } from "../src/middleware/auth.js";
import { clearWecomAuthCache, loadWecomAuthClients } from "../src/modules/wecom/service.js";

describe("auth helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearWecomAuthCache();
    delete process.env.WECHAT_AUTH_CLIENTS;
  });

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
      clientId: "work-report",
      name: "张师傅",
      avatar: null
    });

    expect(verifyLocalToken(token, ["work-report"])).toMatchObject({
      userId: "worker-1",
      sub: "worker-1",
      clientId: "work-report",
      name: "张师傅",
      avatar: null
    });
    expect(verifyLocalToken(token, ["old-client"])).toBeNull();
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
                contactCorpSecret: "contact-secret",
                name: "frontend",
                clientId: "work-report",
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
        clientId: "work-report",
        corpId: "ww-test",
        corpName: "test-corp",
        agentId: 1000001,
        appName: "frontend",
        corpSecret: "secret",
        contactCorpSecret: "contact-secret",
        allowedOrigins: ["https://app.example.com"],
        scopes: ["profile:read"]
      })
    ]);
  });

  it("loads the shared WeCom contact secret from simple env config", () => {
    const clients = loadWecomAuthClients(
      {
        WECOM_CORP_ID: "ww-test",
        WECOM_AGENT_ID: "1000001",
        WECOM_CORP_SECRET: "login-secret",
        WECOM_CONTACT_CORP_SECRET: "contact-secret"
      } as NodeJS.ProcessEnv,
      "C:\\does-not-exist"
    );

    expect(clients).toEqual([
      expect.objectContaining({
        clientId: "work-report",
        corpSecret: "login-secret",
        contactCorpSecret: "contact-secret"
      })
    ]);
  });

  it("maps old WeCom frontend env and client ids to the single project client", () => {
    const clients = loadWecomAuthClients(
      {
        WECOM_NEW_CORP_ID: "ww-test",
        WECOM_NEW_AGENT_ID: "1000001",
        WECOM_NEW_CORP_SECRET: "login-secret",
        WECOM_CONTACT_CORP_SECRET: "contact-secret"
      } as NodeJS.ProcessEnv,
      "C:\\does-not-exist"
    );

    expect(clients).toEqual([
      expect.objectContaining({
        clientId: "work-report",
        corpSecret: "login-secret",
        contactCorpSecret: "contact-secret"
      })
    ]);
  });
});
