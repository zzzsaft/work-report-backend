import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/lib/config.js";
import { generateLocalToken, verifyLocalToken } from "../src/lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles } from "../src/middleware/auth.js";
import { decryptJson, encryptJson, type WechatProxyEncryptedBody } from "../src/modules/wecom/crypto.js";
import {
  batchDeleteWecomContactUsers,
  clearWecomAuthCache,
  createWecomContactUser,
  exchangeWecomCode,
  getWecomJoinQrcode,
  inviteWecomContacts,
  loadWecomAuthClients,
  syncWecomUserDepartmentIds,
  updateWecomContactUser
} from "../src/modules/wecom/service.js";

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
            clientId: "work-report"
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
        clientId: "work-report",
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
      expect(verifyLocalToken(result.token, ["work-report"])).toMatchObject({
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
            clientId: "work-report"
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
      const result = await exchangeWecomCode("work-report", "oauth-code");

      expect(result.user).toMatchObject({
        userId: "zz",
        name: "zz"
      });
      expect(verifyLocalToken(result.token, ["work-report"])?.name).toBeUndefined();
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });

  it("creates WeCom contact users through the configured proxy", async () => {
    const originalWechatProxyCryptoSecret = config.wechatProxyCryptoSecret;
    config.wechatProxyCryptoSecret = "test-proxy-secret";
    process.env.WECHAT_AUTH_CLIENTS = JSON.stringify([
      {
        corpId: "ww-test",
        apps: [
          {
            agentId: 1000001,
            corpSecret: "app-secret",
            contactCorpSecret: "contact-secret",
            clientId: "work-report"
          }
        ]
      }
    ]);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(new URL(String(url)).pathname).toBe("/wechat/proxy");
      const body = JSON.parse(String(init?.body)) as WechatProxyEncryptedBody;
      const proxyRequest = decryptJson<{
        method: string;
        path: string;
        query: Record<string, string>;
        payload: Record<string, unknown>;
      }>(body.encrypted, config.wechatProxyCryptoSecret);

      const responseByPath: Record<string, unknown> = {
        "/cgi-bin/gettoken": { errcode: 0, access_token: "contact-token", expires_in: 7200 },
        "/cgi-bin/user/create": {
          errcode: 0,
          errmsg: "created",
          created_department_list: {
            department_info: [{ name: "生产部", id: 123 }]
          }
        }
      };

      if (proxyRequest.path === "/cgi-bin/gettoken") {
        expect(proxyRequest.query.corpsecret).toBe("contact-secret");
      }
      if (proxyRequest.path === "/cgi-bin/user/create") {
        expect(proxyRequest.method).toBe("POST");
        expect(proxyRequest.query.access_token).toBe("contact-token");
        expect(proxyRequest.payload).toMatchObject({
          userid: "zhangsan",
          name: "张三",
          department: [1, 2]
        });
      }

      return new Response(
        JSON.stringify({
          encrypted: encryptJson(responseByPath[proxyRequest.path], config.wechatProxyCryptoSecret)
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        createWecomContactUser("work-report", {
          userid: "zhangsan",
          name: "张三",
          department: [1, 2],
          mobile: "13800000000"
        })
      ).resolves.toEqual({
        errcode: 0,
        errmsg: "created",
        createdDepartmentList: {
          department_info: [{ name: "生产部", id: 123 }]
        }
      });
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });

  it("updates, batch deletes, and invites WeCom contacts through the configured proxy", async () => {
    const originalWechatProxyCryptoSecret = config.wechatProxyCryptoSecret;
    config.wechatProxyCryptoSecret = "test-proxy-secret";
    process.env.WECHAT_AUTH_CLIENTS = JSON.stringify([
      {
        corpId: "ww-test",
        apps: [
          {
            agentId: 1000001,
            corpSecret: "app-secret",
            contactCorpSecret: "contact-secret",
            clientId: "work-report"
          }
        ]
      }
    ]);

    const seenPaths: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(new URL(String(url)).pathname).toBe("/wechat/proxy");
      const body = JSON.parse(String(init?.body)) as WechatProxyEncryptedBody;
      const proxyRequest = decryptJson<{
        method: string;
        path: string;
        query: Record<string, string>;
        payload: Record<string, unknown>;
      }>(body.encrypted, config.wechatProxyCryptoSecret);
      seenPaths.push(proxyRequest.path);

      const responseByPath: Record<string, unknown> = {
        "/cgi-bin/gettoken": { errcode: 0, access_token: "contact-token", expires_in: 7200 },
        "/cgi-bin/user/update": { errcode: 0, errmsg: "updated" },
        "/cgi-bin/user/batchdelete": { errcode: 0, errmsg: "deleted" },
        "/cgi-bin/batch/invite": {
          errcode: 0,
          errmsg: "ok",
          invaliduser: ["missing-user"],
          invalidparty: [2],
          invalidtag: [102]
        }
      };

      if (proxyRequest.path === "/cgi-bin/user/update") {
        expect(proxyRequest.method).toBe("POST");
        expect(proxyRequest.query.access_token).toBe("contact-token");
        expect(proxyRequest.payload).toMatchObject({
          userid: "zhangsan",
          name: "李四",
          position: "后台工程师"
        });
      }
      if (proxyRequest.path === "/cgi-bin/user/batchdelete") {
        expect(proxyRequest.payload).toEqual({ useridlist: ["zhangsan", "lisi"] });
      }
      if (proxyRequest.path === "/cgi-bin/batch/invite") {
        expect(proxyRequest.payload).toEqual({
          user: ["zhangsan"],
          party: [1],
          tag: [101]
        });
      }

      return new Response(
        JSON.stringify({
          encrypted: encryptJson(responseByPath[proxyRequest.path], config.wechatProxyCryptoSecret)
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        updateWecomContactUser("work-report", {
          userid: "zhangsan",
          name: "李四",
          position: "后台工程师"
        })
      ).resolves.toEqual({ errcode: 0, errmsg: "updated" });

      await expect(batchDeleteWecomContactUsers("work-report", ["zhangsan", "lisi"])).resolves.toEqual({
        errcode: 0,
        errmsg: "deleted"
      });

      await expect(inviteWecomContacts("work-report", { user: ["zhangsan"], party: [1], tag: [101] })).resolves.toEqual({
        errcode: 0,
        errmsg: "ok",
        invalidUser: ["missing-user"],
        invalidParty: [2],
        invalidTag: [102],
        invaliduser: ["missing-user"],
        invalidparty: [2],
        invalidtag: [102]
      });

      await expect(updateWecomContactUser("work-report", { name: "李四" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(batchDeleteWecomContactUsers("work-report", [])).rejects.toMatchObject({ statusCode: 400 });
      await expect(inviteWecomContacts("work-report", {})).rejects.toMatchObject({ statusCode: 400 });
      expect(seenPaths).toContain("/cgi-bin/user/update");
      expect(seenPaths).toContain("/cgi-bin/user/batchdelete");
      expect(seenPaths).toContain("/cgi-bin/batch/invite");
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });

  it("gets WeCom join qrcodes through the configured proxy", async () => {
    const originalWechatProxyCryptoSecret = config.wechatProxyCryptoSecret;
    config.wechatProxyCryptoSecret = "test-proxy-secret";
    process.env.WECHAT_AUTH_CLIENTS = JSON.stringify([
      {
        corpId: "ww-test",
        apps: [
          {
            agentId: 1000001,
            corpSecret: "app-secret",
            contactCorpSecret: "contact-secret",
            clientId: "work-report"
          }
        ]
      }
    ]);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(new URL(String(url)).pathname).toBe("/wechat/proxy");
      const body = JSON.parse(String(init?.body)) as WechatProxyEncryptedBody;
      const proxyRequest = decryptJson<{
        path: string;
        query: Record<string, string>;
      }>(body.encrypted, config.wechatProxyCryptoSecret);

      const responseByPath: Record<string, unknown> = {
        "/cgi-bin/gettoken": { errcode: 0, access_token: "contact-token", expires_in: 7200 },
        "/cgi-bin/corp/get_join_qrcode": {
          errcode: 0,
          errmsg: "ok",
          join_qrcode: "https://work.weixin.qq.com/wework_admin/genqrcode?action=join&qr_size=3"
        }
      };

      if (proxyRequest.path === "/cgi-bin/corp/get_join_qrcode") {
        expect(proxyRequest.query.access_token).toBe("contact-token");
        expect(proxyRequest.query.size_type).toBe(3);
      }

      return new Response(
        JSON.stringify({
          encrypted: encryptJson(responseByPath[proxyRequest.path], config.wechatProxyCryptoSecret)
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(getWecomJoinQrcode("work-report", 3)).resolves.toEqual({
        errcode: 0,
        errmsg: "ok",
        joinQrcode: "https://work.weixin.qq.com/wework_admin/genqrcode?action=join&qr_size=3",
        join_qrcode: "https://work.weixin.qq.com/wework_admin/genqrcode?action=join&qr_size=3",
        expiresInDays: 7,
        sizeType: 3
      });
      await expect(getWecomJoinQrcode("work-report", 5)).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      config.wechatProxyCryptoSecret = originalWechatProxyCryptoSecret;
    }
  });

  it("rejects cursor-based full syncs to avoid replacing partial WeCom department data", async () => {
    await expect(syncWecomUserDepartmentIds("work-report", { cursor: "next-page" })).rejects.toMatchObject({
      statusCode: 400,
      message: "CURSOR_NOT_ALLOWED_FOR_FULL_SYNC"
    });
  });
});
