const logger = require('../services/logger');

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    errorCode: 'ROUTE_NOT_FOUND',
  });
};

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled request error', {
    method: req.method,
    url: req.originalUrl,
    message: err && err.message,
    stack: err && err.stack,
  });

  const status = err && err.statusCode ? err.statusCode : 500;
  const message = err && err.message ? err.message : 'Internal Server Error';

  res.status(status).json({
    success: false,
    message,
    errorCode: err && err.errorCode ? err.errorCode : 'INTERNAL_SERVER_ERROR',
  });
};

module.exports = { notFoundHandler, errorHandler };
