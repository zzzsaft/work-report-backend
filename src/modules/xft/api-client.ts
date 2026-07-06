import axios from "axios";
import { buildEncryptedXftRequestBody, parseXftResponseData, sm2, sm3 } from "./crypto.js";
import type { PersistedXftConfig, XftHttpClient } from "./types.js";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export class XftApiClient implements XftHttpClient {
  constructor(private readonly configRow: PersistedXftConfig) {}

  private genHeaders(timestamp: number, body: string, requestPath: string, method: string) {
    const header: Record<string, string | number> = {
      "Content-Type": "application/json; charset=utf-8",
      appid: this.configRow.appid,
      "x-alb-timestamp": timestamp,
      apisign: sm2.doSignature(
        method === "POST"
          ? `POST ${requestPath}\nx-alb-digest: ${body}\nx-alb-timestamp: ${timestamp}`
          : `GET ${requestPath}\nx-alb-timestamp: ${timestamp}`,
        this.configRow.appSecret,
        { hash: true }
      ),
      "x-alb-verify": "sm3withsm2"
    };

    if (method === "POST") header["x-alb-digest"] = sm3(body);
    return header;
  }

  private buildPathWithQuery = (
    path: string,
    queryParams: Record<string, string | number | boolean | null | undefined> = {}
  ) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const query = new URLSearchParams({
      CSCAPPUID: this.configRow.appid,
      CSCPRJCOD: this.configRow.enterpriseId,
      CSCREQTIM: String(timestamp * 1000),
      CSCUSRNBR: this.configRow.defaultUserId,
      CSCUSRUID: this.configRow.defaultPlatformUserId
    });
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const pathWithQuery = `${path}?${query.toString()}`;
    return { timestamp, pathWithQuery };
  };

  get = async (path: string, queryParams: Record<string, string | number | boolean | null | undefined> = {}) => {
    const { timestamp, pathWithQuery } = this.buildPathWithQuery(path, queryParams);

    const response = await axios({
      method: "GET",
      url: `${trimTrailingSlash(this.configRow.host)}${pathWithQuery}`,
      timeout: 100000,
      responseType: "text",
      transformResponse: [(data) => data],
      headers: this.genHeaders(timestamp, "", pathWithQuery, "GET")
    });

    return parseXftResponseData(response.data, this.configRow.appSecret);
  };

  post = async (path: string, payload: unknown) => {
    const { timestamp, pathWithQuery } = this.buildPathWithQuery(path);
    const body = buildEncryptedXftRequestBody(payload ?? {}, this.configRow.appSecret);

    const response = await axios({
      method: "POST",
      url: `${trimTrailingSlash(this.configRow.host)}${pathWithQuery}`,
      data: body,
      timeout: 100000,
      responseType: "text",
      transformRequest: [(data) => data],
      transformResponse: [(data) => data],
      headers: this.genHeaders(timestamp, body, pathWithQuery, "POST")
    });

    return parseXftResponseData(response.data, this.configRow.appSecret);
  };
}
