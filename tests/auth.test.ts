import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/lib/config.js";
import { generateLocalToken, verifyLocalToken } from "../src/lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles } from "../src/middleware/auth.js";
import { decryptJson, encryptJson, type WechatProxyEncryptedBody } from "../src/modules/auth/wechat-proxy-crypto.js";
import { clearWecomAuthCache, exchangeWecomCode, loadWecomAuthClients } from "../src/modules/auth/wecom.js";

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

  it("returns the WeCom member avatar for userid zz after code exchange", async () => {
    const originalWechatProxyCryptoSecret = config.wechatProxyCryptoSecret;
    config.wechatProxyCryptoSecret = "test-proxy-secret";
    process.env.WECHAT_AUTH_CLIENTS = JSON.stringify([
      {
        corpId: "ww-test",
        apps: [
          {
            agentId: 1000001,
            corpSecret: "secret",
            clientId: "new-frontend"
          }
        ]
      }
    ]);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.pathname).toBe("/wechat/proxy");

      const body = JSON.parse(String(init?.body)) as WechatProxyEncryptedBody;
      const proxyRequest = decryptJson<{
        method: string;
        path: string;
        query: Record<string, string>;
      }>(body.encrypted, config.wechatProxyCryptoSecret);

      const responseByPath: Record<string, unknown> = {
        "/cgi-bin/gettoken": { errcode: 0, access_token: "access-token", expires_in: 7200 },
        "/cgi-bin/auth/getuserinfo": { errcode: 0, userid: "zz" },
        "/cgi-bin/user/get": {
          errcode: 0,
          userid: "zz",
          name: "zz",
          avatar: "https://wecom.example/avatar/zz.png",
          thumb_avatar: "https://wecom.example/avatar/zz-thumb.png"
        }
      };

      if (proxyRequest.path === "/cgi-bin/user/get") {
        expect(proxyRequest.query.userid).toBe("zz");
      }

      return new Response(
        JSON.stringify({
          encrypted: encryptJson(responseByPath[proxyRequest.path], config.wechatProxyCryptoSecret)
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await exchangeWecomCode("new-frontend", "oauth-code");

      expect(result.user).toMatchObject({
        userId: "zz",
        wecomUserId: "zz",
        clientId: "new-frontend",
        name: "zz",
        avatar: "https://wecom.example/avatar/zz.png"
      });
      expect(verifyLocalToken(result.token, ["new-frontend"])).toMatchObject({
        userId: "zz",
        wecomUserId: "zz",
        avatar: "https://wecom.example/avatar/zz.png"
      });
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });
});
