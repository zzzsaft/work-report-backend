import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/lib/config.js";
import { decryptJson, encryptJson, type WechatProxyEncryptedBody } from "../src/modules/wecom/crypto.js";
import {
  batchDeleteWecomContactUsers,
  clearWecomAuthCache,
  createWecomContactUser,
  getWecomJoinQrcode,
  inviteWecomContacts,
  syncWecomUserDepartmentIds,
  updateWecomContactUser
} from "../src/modules/wecom/service.js";

describe("WeCom contact APIs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearWecomAuthCache();
    delete process.env.WECHAT_AUTH_CLIENTS;
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
