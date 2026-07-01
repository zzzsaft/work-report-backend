import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { config } from "./lib/config.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { installAxiosLogger } from "./lib/axios-logger.js";
import { authenticate } from "./middleware/auth.js";
import { expressLogger } from "./middleware/express-logger.js";
import { authRouter } from "./modules/auth/routes.js";
import { wecomRouter } from "./modules/wecom/routes.js";
import { workReportRouter } from "./modules/work-report/routes.js";
import { xftRouter } from "./modules/xft/routes.js";

installAxiosLogger();

export const createApp = () => {
  const app = express();

  app.use(
    cors({
      origin:
        config.corsOrigin === "*" && config.corsCredentials
          ? true
          : config.corsOrigin,
      credentials: config.corsCredentials,
    }),
  );
  app.use(
    express.json({
      limit: "20mb",
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(cookieParser());
  app.use(expressLogger);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(authRouter);
  app.use(wecomRouter);
  app.use(authenticate);
  app.use(workReportRouter);
  app.use(xftRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
