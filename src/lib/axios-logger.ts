import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from "axios";
import { Prisma } from "@prisma/client";
import { sanitizeLogPayload } from "./log-sanitizer.js";
import { prisma } from "./prisma.js";

interface AxiosLogMeta {
  startedAt: bigint;
}

const AXIOS_LOGGER_INSTALLED = Symbol.for("work-report-backend.axios-logger.installed");

interface AxiosClientWithLoggerFlag extends AxiosInstance {
  [AXIOS_LOGGER_INSTALLED]?: boolean;
}

const requestMeta = new WeakMap<InternalAxiosRequestConfig, AxiosLogMeta>();

const durationFrom = (startedAt: bigint) => Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

const writeAxiosLog = async (
  config: InternalAxiosRequestConfig,
  statusCode: number | null,
  durationMs: number,
  responseBody: unknown,
  errorMessage?: string
) => {
  await prisma.axiosRequestLog.create({
    data: {
      method: (config.method || "GET").toUpperCase(),
      url: config.url || "",
      baseUrl: config.baseURL,
      statusCode,
      durationMs,
      requestBody: sanitizeLogPayload(config.data) ?? Prisma.JsonNull,
      responseBody: sanitizeLogPayload(responseBody) ?? Prisma.JsonNull,
      errorMessage
    }
  });
};

const logResponse = async (response: AxiosResponse) => {
  const meta = requestMeta.get(response.config);
  await writeAxiosLog(
    response.config,
    response.status,
    meta ? durationFrom(meta.startedAt) : 0,
    response.data
  );
};

const logError = async (error: AxiosError) => {
  if (!error.config) return;

  const meta = requestMeta.get(error.config);
  await writeAxiosLog(
    error.config,
    error.response?.status ?? null,
    meta ? durationFrom(meta.startedAt) : 0,
    error.response?.data,
    error.message
  );
};

export const installAxiosLogger = (client: AxiosInstance = axios) => {
  const flaggedClient = client as AxiosClientWithLoggerFlag;
  if (flaggedClient[AXIOS_LOGGER_INSTALLED]) return client;
  flaggedClient[AXIOS_LOGGER_INSTALLED] = true;

  flaggedClient.interceptors.request.use((config) => {
    requestMeta.set(config, { startedAt: process.hrtime.bigint() });
    return config;
  });

  flaggedClient.interceptors.response.use(
    (response) => {
      void logResponse(response).catch((error) => {
        console.error("Failed to write axios request log", error);
      });
      return response;
    },
    (error: AxiosError) => {
      void logError(error).catch((logWriteError) => {
        console.error("Failed to write axios request log", logWriteError);
      });
      return Promise.reject(error);
    }
  );

  return client;
};

export const httpClient = installAxiosLogger(axios.create());
