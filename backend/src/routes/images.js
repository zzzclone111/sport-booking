const express = require("express");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../utils/http");

const router = express.Router();
const NAME = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:jpg|png|webp)$/;
let client;

function storage() {
  const required = [
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ];
  if (required.some((name) => !process.env[name])) {
    throw new ApiError(503, "Chưa cấu hình dịch vụ lưu ảnh");
  }

  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      forcePathStyle: true,
      // Hữu ích khi S3-compatible endpoint không hỗ trợ checksum CRC32
      // mà các bản AWS SDK mới tự thêm vào yêu cầu upload.
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

function detectedImage(buffer) {
  if (buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }

  if (buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  )) {
    return { mime: "image/png", extension: "png" };
  }

  if (buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }

  return null;
}

// File được gửi dạng binary, không phải JSON hoặc multipart.
router.post(
  "/",
  authenticate,
  authorize("OWNER"),
  express.raw({ type: "image/*", limit: "5mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new ApiError(415, "Chỉ nhận ảnh JPEG, PNG hoặc WebP");
    }

    const image = detectedImage(req.body);
    const declaredMime = req.get("Content-Type")?.split(";")[0].trim();

    if (!image || image.mime !== declaredMime) {
      throw new ApiError(415, "Định dạng hoặc nội dung ảnh không hợp lệ");
    }

    const filename = `${randomUUID()}.${image.extension}`;

    await storage().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: `images/${filename}`,
      Body: req.body,
      ContentLength: req.body.length,
      ContentType: image.mime,
    }));

    res.status(201).json({ imageUrl: `/api/images/${filename}` });
  }),
);

router.get(
  "/:filename",
  asyncHandler(async (req, res) => {
    const { filename } = req.params;
    if (!NAME.test(filename)) {
      throw new ApiError(404, "Không tìm thấy ảnh");
    }

    let object;
    try {
      object = await storage().send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `images/${filename}`,
      }));
    } catch (error) {
      if (error.name === "NoSuchKey" ||
          error.$metadata?.httpStatusCode === 404) {
        throw new ApiError(404, "Không tìm thấy ảnh");
      }
      throw error;
    }

    res.set("Content-Type", object.ContentType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=86400");
    await pipeline(object.Body, res);
  }),
);

module.exports = router;
