const AppError = require("../utils/AppError");
const userRepository = require("../repositories/userRepository");
const { verifyAccessToken } = require("../services/tokenService");

function bearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

async function authenticate(req, _res, next) {
  try {
    const token = bearerToken(req);
    if (!token) {
      throw new AppError("Please log in to continue.", {
        status: 401,
        code: "AUTH_REQUIRED",
      });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      throw new AppError(
        error.name === "TokenExpiredError" ? "Your session has expired. Please log in again." : "Your session is not valid. Please log in again.",
        {
          status: 401,
          code: error.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
        }
      );
    }

    const user = await userRepository.findById(payload.sub);
    if (!user || user.isBanned) {
      throw new AppError("This account is not available.", {
        status: 401,
        code: "ACCOUNT_UNAVAILABLE",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError("Please log in to continue.", { status: 401, code: "AUTH_REQUIRED" }));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError("You do not have access to this resource.", { status: 403, code: "FORBIDDEN" }));
    }
    return next();
  };
}

function requireVerified(req, _res, next) {
  if (req.user?.verificationStatus === "approved") return next();

  const rejected = req.user?.verificationStatus === "rejected";
  return next(
    new AppError(
      rejected
        ? "This account is not approved for rides. Please contact support."
        : "Your account is under review. You can explore SheDrive, but rides unlock after approval.",
      {
        status: 403,
        code: rejected ? "ACCOUNT_REJECTED" : "ACCOUNT_PENDING_REVIEW",
      }
    )
  );
}

module.exports = { authenticate, requireRole, requireVerified };
