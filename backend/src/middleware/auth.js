const jwt = require("jsonwebtoken");
const config = require("../config");
const { pool } = require("../db");
const { ApiError } = require("../utils/http");

async function authenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, "Vui lòng đăng nhập"));

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const result = await pool.query(
      "SELECT id, full_name, role, status FROM users WHERE id = $1",
      [payload.sub],
    );
    const user = result.rows[0];
    if (!user || user.status !== "ACTIVE")
      return next(new ApiError(403, "Tài khoản không hoạt động"));
    req.user = {
      ...payload,
      sub: user.id,
      role: user.role,
      name: user.full_name,
    };
    next();
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return next(
        new ApiError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn"),
      );
    }
    next(error);
  }
}

function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new ApiError(403, "Bạn không có quyền thực hiện thao tác này"),
      );
    }
    next();
  };
}

module.exports = { authenticate, authorize };
