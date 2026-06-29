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
        payload: Record<string, string>;
      }>(body.encrypted, config.wechatProxyCryptoSecret);

      const responseByPath: Record<string, unknown> = {
        "/cgi-bin/gettoken": { errcode: 0, access_token: "access-token", expires_in: 7200 },
        "/cgi-bin/auth/getuserinfo": { errcode: 0, userid: "zz", user_ticket: "user-ticket" },
        "/cgi-bin/auth/getuserdetail": {
          errcode: 0,
          userid: "zz",
          gender: "1",
          avatar: "https://wecom.example/avatar/zz.png",
          qr_code: "https://open.work.weixin.qq.com/wwopen/userQRCode?vcode=zz",
          mobile: "13800000000",
          email: "zz@example.com",
          biz_mail: "zz@qyycs2.wecom.work",
          address: ""
        },
        "/cgi-bin/user/get": {
          errcode: 0,
          userid: "zz",
          name: "张三",
          avatar: "https://wecom.example/avatar/contact-zz.png",
          thumb_avatar: "https://wecom.example/avatar/contact-zz-thumb.png",
          department: [1, 2],
          order: [10, 20],
          position: "工程师",
          is_leader_in_dept: [0, 1],
          direct_leader: ["leader-1"],
          telephone: "0571-12345678",
          alias: "zhangsan",
          extattr: { attrs: [] },
          status: 1,
          external_profile: { external_attr: [] },
          external_position: "技术顾问",
          open_userid: "open-zz",
          main_department: 2
        }
      };

      if (proxyRequest.path === "/cgi-bin/auth/getuserdetail") {
        expect(proxyRequest.method).toBe("POST");
        expect(proxyRequest.payload.user_ticket).toBe("user-ticket");
      }
      if (proxyRequest.path === "/cgi-bin/user/get") {
        expect(proxyRequest.method).toBe("GET");
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
        name: "张三",
        avatar: "https://wecom.example/avatar/zz.png",
        gender: "1",
        mobile: "13800000000",
        email: "zz@example.com",
        bizMail: "zz@qyycs2.wecom.work",
        address: null,
        department: [1, 2],
        departmentOrder: [10, 20],
        position: "工程师",
        isLeaderInDept: [0, 1],
        directLeader: ["leader-1"],
        telephone: "0571-12345678",
        alias: "zhangsan",
        extattr: { attrs: [] },
        wecomStatus: 1,
        externalProfile: { external_attr: [] },
        externalPosition: "技术顾问",
        openUserid: "open-zz",
        mainDepartment: 2
      });
      expect(verifyLocalToken(result.token, ["new-frontend"])).toMatchObject({
        userId: "zz",
        wecomUserId: "zz",
        name: "张三",
        avatar: "https://wecom.example/avatar/zz.png",
        mobile: "13800000000",
        email: "zz@example.com",
        department: [1, 2],
        departmentOrder: [10, 20],
        position: "工程师",
        wecomStatus: 1,
        openUserid: "open-zz",
        mainDepartment: 2
      });
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });

  it("does not treat userid returned as name as a real WeCom display name", async () => {
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
      expect(new URL(String(url)).pathname).toBe("/wechat/proxy");
      const body = JSON.parse(String(init?.body)) as WechatProxyEncryptedBody;
      const proxyRequest = decryptJson<{ path: string }>(body.encrypted, config.wechatProxyCryptoSecret);
      const responseByPath: Record<string, unknown> = {
        "/cgi-bin/gettoken": { errcode: 0, access_token: "access-token", expires_in: 7200 },
        "/cgi-bin/auth/getuserinfo": { errcode: 0, userid: "zz" },
        "/cgi-bin/user/get": { errcode: 0, userid: "zz", name: "zz" }
      };

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
        name: "zz"
      });
      expect(verifyLocalToken(result.token, ["new-frontend"])?.name).toBeUndefined();
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });
});
