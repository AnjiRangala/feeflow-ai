import { AppError, asyncHandler } from '../lib/errors.js';
import { toPublicUser, verifyAccessToken } from '../lib/auth.js';

export function createAuthenticate({ User, jwtSecret }) {
  return asyncHandler(async (req, res, next) => {
    const authorization = req.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new AppError(401, 'Authentication required');
    }

    let claims;
    try {
      claims = verifyAccessToken(authorization.slice(7), jwtSecret);
    } catch {
      throw new AppError(401, 'Invalid or expired access token');
    }

    const user = await User.findById(claims.sub);
    if (!user?.isActive) {
      throw new AppError(401, 'Account is unavailable');
    }
    req.user = toPublicUser(user);
    return next();
  });
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'You do not have permission to access this resource'));
    }
    return next();
  };
}
