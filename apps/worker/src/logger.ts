import pino from "pino";

const transport = process.env.NODE_ENV === "production"
  ? undefined
  : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } };

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.DEBUG === "1" ? "debug" : "info"),
  ...(transport ? { transport } : {}),
});

export default logger;
