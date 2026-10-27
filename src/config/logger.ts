import pino from 'pino';
import pinoHttp from 'pino-http';

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.body.password',
      'req.body.token',
      'req.body.content',
      'req.body.pdfBuffer',
      'apiKey',
      'passwordHash'
    ],
    censor: '[REDACTED_BY_NFR08]'
  }
});

export const httpLogger = pinoHttp({ logger });