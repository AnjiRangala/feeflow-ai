import { AppError } from '../lib/errors.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'Route not found'));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const bodyParserStatus = error.type === 'entity.parse.failed' ? 400 :
    error.type === 'entity.too.large' ? 413 : null;
  const status = error instanceof AppError ? error.status : bodyParserStatus ?? 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' :
      status === 400 && bodyParserStatus ? 'Invalid JSON body' :
        status === 413 ? 'Request body is too large' : error.message
  });
}
