import { createHmac, randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/lib/config.js";
import { clearAuthCache } from "../src/middleware/auth.js";

const { importThirdPartyOperations } = vi.hoisted(() => ({
  importThirdPartyOperations: vi.fn()
}));

vi.mock("../src/modules/work-report/service.js", () => ({
  MAX_IMPORT_OPERATIONS: 40000,
  workReportService: {
    importThirdPartyOperations
  }
}));

const API_KEY = "test-import-key";
const API_SECRET = "test-import-secret";

const operation = {
  orderNo: "WO-SIGN-1",
  productCode: "PRD-SIGN",
  productName: "签名测试产品",
  partNo: "1",
  partCode: "PART-SIGN",
  partName: "签名测试零件",
  operationNo: "10",
  operationCode: "OP-SIGN",
  operationName: "签名测试工序",
  estimatedHours: 1,
  plannedQuantity: 1,
  dueDate: null
};

type InjectableApp = {
  handle: (req: IncomingMessage, res: ServerResponse) => void;
};

const createSignedHeaders = (body: string, nonce: string = randomUUID()) => {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", API_SECRET)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");

  return {
    "content-type": "application/json",
    "x-import-key": API_KEY,
    "x-import-timestamp": timestamp,
    "x-import-nonce": nonce,
    "x-import-signature": signature
  };
};

const injectJson = async (app: InjectableApp, path: string, body: string, headers: Record<string, string> = {}) => {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = "POST";
  req.url = path;
  req.headers = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body).toString(),
    ...headers
  };
  req.push(body);
  req.push(null);

  const res = new ServerResponse(req);
  let responseBody = "";

  return await new Promise<{ status: number; body: string; json: unknown }>((resolve) => {
    res.assignSocket(socket);
    res.write = ((chunk: unknown) => {
      responseBody += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      return true;
    }) as typeof res.write;
    res.end = ((chunk?: unknown) => {
      if (chunk) responseBody += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      let json: unknown = undefined;
      try {
        json = responseBody ? JSON.parse(responseBody) : undefined;
      } catch {
        json = undefined;
      }
      resolve({ status: res.statusCode, body: responseBody, json });
      return res;
    }) as typeof res.end;

    app.handle(req, res);
  });
};

describe("signed operation import", () => {
  let app: InjectableApp;
  const originalImportApiKey = config.importApiKey;
  const originalImportApiSecret = config.importApiSecret;

  beforeEach(() => {
    app = createApp() as unknown as InjectableApp;
    clearAuthCache();
    importThirdPartyOperations.mockReset();
    importThirdPartyOperations.mockResolvedValue({ accepted: 1, rejected: 0, items: [], errors: [] });
    config.importApiKey = API_KEY;
    config.importApiSecret = API_SECRET;
  });

  afterEach(async () => {
    config.importApiKey = originalImportApiKey;
    config.importApiSecret = originalImportApiSecret;
    clearAuthCache();
  });

  it("rejects import requests without signature headers", async () => {
    const response = await injectJson(app, "/api/operations/import", JSON.stringify([operation]));

    expect(response.status).toBe(401);
    expect(importThirdPartyOperations).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed import request", async () => {
    const body = JSON.stringify([operation]);

    const response = await injectJson(app, "/api/operations/import", body, createSignedHeaders(body));

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({ accepted: 1, rejected: 0 });
    expect(importThirdPartyOperations).toHaveBeenCalledWith(
      [operation],
      expect.objectContaining({ id: "system-import", roles: ["leader"] })
    );
  });

  it("rejects replayed import nonce", async () => {
    const body = JSON.stringify([operation]);
    const headers = createSignedHeaders(body, "replayed-nonce");

    const firstResponse = await injectJson(app, "/api/operations/import", body, headers);
    const replayResponse = await injectJson(app, "/api/operations/import", body, headers);

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(401);
    expect(importThirdPartyOperations).toHaveBeenCalledTimes(1);
  });
});
