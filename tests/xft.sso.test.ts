import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { config } from "../src/lib/config.js";
import { AppError } from "../src/lib/errors.js";
import { generateLocalToken } from "../src/lib/jwt.js";
import { buildXftSsoLoginUrl, xftSsoLogin } from "../src/modules/xft/sso.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const decryptSecret = (url: string) => {
  const secret = new URL(url).searchParams.get("secret");
  if (!secret) throw new Error("missing secret");
  return JSON.parse(
    privateDecrypt(
      {
        key: privatePem,
        padding: constants.RSA_PKCS1_PADDING
      },
      Buffer.from(secret, "base64")
    ).toString("utf8")
  ) as { userid: string; timestamp: number };
};

describe("xft sso", () => {
  it("builds a default workbench login URL with encrypted user info", () => {
    const url = buildXftSsoLoginUrl({
      userid: "zhangsan",
      timestamp: 123456,
      privateKey: privatePem,
      connectorId: "connector",
      flowId: "flow",
      loginBaseUrl: "https://xft.example.com/login"
    });

    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://xft.example.com/login/connector_flow");
    expect(parsed.searchParams.get("pageId")).toBe("workbench");
    expect(decryptSecret(url)).toEqual({ userid: "zhangsan", timestamp: 123456 });
  });

  it("uses todo parameters ahead of pageId", () => {
    const url = buildXftSsoLoginUrl({
      userid: "zhangsan",
      todoId: "todo-1",
      pageId: "salary",
      timestamp: 123456,
      privateKey: privatePem,
      connectorId: "connector",
      flowId: "flow",
      loginBaseUrl: "https://xft.example.com/login"
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("pageId")).toBeNull();
    expect(parsed.searchParams.get("extTyp")).toBe("todo");
    expect(parsed.searchParams.get("extPam")).toBe(JSON.stringify({ toDoType: "0", toDoId: "todo-1" }));
  });

  it("rejects an empty userid", () => {
    expect(() =>
      buildXftSsoLoginUrl({
        userid: "",
        privateKey: privatePem
      })
    ).toThrow(AppError);
  });

  it("redirects from a frontend token that contains wecomUserId", async () => {
    const originalPrivateKey = config.xftSsoPrivateKey;
    const originalConnectorId = config.xftSsoConnectorId;
    const originalFlowId = config.xftSsoFlowId;
    const originalLoginBaseUrl = config.xftSsoLoginBaseUrl;
    config.xftSsoPrivateKey = privatePem;
    config.xftSsoConnectorId = "connector";
    config.xftSsoFlowId = "flow";
    config.xftSsoLoginBaseUrl = "https://xft.example.com/login";

    const token = generateLocalToken({
      userId: "frontend-user",
      wecomUserId: "wecom-user",
      clientId: "work-report",
      name: "前端用户"
    });
    const redirect = vi.fn();

    try {
      await xftSsoLogin(
        {
          query: { token, pageId: "salary" },
          headers: {},
          cookies: {}
        } as unknown as Request,
        { redirect } as unknown as Response,
        vi.fn()
      );
    } finally {
      config.xftSsoPrivateKey = originalPrivateKey;
      config.xftSsoConnectorId = originalConnectorId;
      config.xftSsoFlowId = originalFlowId;
      config.xftSsoLoginBaseUrl = originalLoginBaseUrl;
    }

    const url = String(redirect.mock.calls[0][0]);
    expect(new URL(url).searchParams.get("pageId")).toBe("salary");
    expect(decryptSecret(url)).toMatchObject({ userid: "wecom-user" });
  });

  it("prefers the auth cookie over query token for browser links", async () => {
    const originalPrivateKey = config.xftSsoPrivateKey;
    const originalConnectorId = config.xftSsoConnectorId;
    const originalFlowId = config.xftSsoFlowId;
    const originalLoginBaseUrl = config.xftSsoLoginBaseUrl;
    config.xftSsoPrivateKey = privatePem;
    config.xftSsoConnectorId = "connector";
    config.xftSsoFlowId = "flow";
    config.xftSsoLoginBaseUrl = "https://xft.example.com/login";

    const queryToken = generateLocalToken({
      userId: "query-user",
      wecomUserId: "query-wecom",
      clientId: "work-report",
      name: "查询用户"
    });
    const cookieToken = generateLocalToken({
      userId: "cookie-user",
      wecomUserId: "cookie-wecom",
      clientId: "work-report",
      name: "Cookie 用户"
    });
    const redirect = vi.fn();

    try {
      await xftSsoLogin(
        {
          query: { token: queryToken },
          headers: {},
          cookies: { [config.authCookieName]: cookieToken }
        } as unknown as Request,
        { redirect } as unknown as Response,
        vi.fn()
      );
    } finally {
      config.xftSsoPrivateKey = originalPrivateKey;
      config.xftSsoConnectorId = originalConnectorId;
      config.xftSsoFlowId = originalFlowId;
      config.xftSsoLoginBaseUrl = originalLoginBaseUrl;
    }

    const url = String(redirect.mock.calls[0][0]);
    expect(decryptSecret(url)).toMatchObject({ userid: "cookie-wecom" });
  });
});
