const { ApiError } = require("../utils/http");

function notFound(req, _res, next) {
  next(new ApiError(404, `Không tìm thấy ${req.method} ${req.originalUrl}`));
}

function errorHandler(error, req, res, _next) {
  if (error.code === "23P01") {
    return res
      .status(409)
      .json({ message: "Khung giờ này vừa được người khác đặt" });
  }
  if (error.code === "23505") {
    return res.status(409).json({ message: "Dữ liệu đã tồn tại" });
  }

  const status = error.status || 500;
  if (status >= 500) req.log?.error({ err: error }, "Request failed");
  res.status(status).json({
    message:
      status >= 500 ? "Có lỗi hệ thống, vui lòng thử lại" : error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

module.exports = { notFound, errorHandler };
