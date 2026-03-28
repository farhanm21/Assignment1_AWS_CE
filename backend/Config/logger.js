const { createLogger, format, transports } = require('winston');
const config = require('./index');

const logger = createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    config.env === 'production'
      ? format.json()
      : format.combine(
          format.colorize(),
          format.printf(({ timestamp, level, message, stack }) =>
            stack
              ? `${timestamp} [${level}] ${message}\n${stack}`
              : `${timestamp} [${level}] ${message}`
          )
        )
  ),
  transports: [
    new transports.Console(),
    ...(config.env === 'production'
      ? [
          new transports.File({ filename: '/var/log/unievent/error.log', level: 'error' }),
          new transports.File({ filename: '/var/log/unievent/combined.log' }),
        ]
      : []),
  ],
});

module.exports = logger;