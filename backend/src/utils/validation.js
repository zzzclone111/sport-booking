const { z } = require("zod");
const { ApiError } = require("./http");

function validate(schema, target = "body") {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(
        new ApiError(400, "Dữ liệu không hợp lệ", result.error.flatten()),
      );
    }
    Object.defineProperty(req, target, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

const uuid = z.string().uuid();
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Thời gian phải có dạng HH:mm");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD");

module.exports = { validate, uuid, time, date, z };
