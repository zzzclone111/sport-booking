const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const config = require("../config");
const { authenticate } = require("../middleware/auth");
const { validate, z } = require("../utils/validation");
const { ApiError, asyncHandler } = require("../utils/http");

const router = express.Router();
const email = z
  .string()
  .email()
  .transform((value) => value.toLowerCase().trim());

const publicUser = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  status: row.status,
});

function createToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
      issuer: "sporthub-api",
    },
  );
}

router.post(
  "/register",
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      email,
      phone: z.string().trim().min(9).max(20).optional(),
      password: z.string().min(8).max(72),
      role: z.enum(["RENTER", "OWNER"]).default("RENTER"),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { fullName, email: userEmail, phone, password, role } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, full_name, email, phone, role, status`,
      [fullName, userEmail, phone || null, passwordHash, role],
    );
    const user = result.rows[0];
    res.status(201).json({ token: createToken(user), user: publicUser(user) });
  }),
);

router.post(
  "/login",
  validate(
    z.object({
      email,
      password: z.string().min(1).max(72),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      req.body.email,
    ]);
    const user = result.rows[0];
    if (
      !user ||
      !(await bcrypt.compare(req.body.password, user.password_hash))
    ) {
      throw new ApiError(401, "Email hoặc mật khẩu không đúng");
    }
    if (user.status !== "ACTIVE")
      throw new ApiError(403, "Tài khoản đang bị khóa");
    res.json({ token: createToken(user), user: publicUser(user) });
  }),
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT id, full_name, email, phone, role, status FROM users WHERE id = $1",
      [req.user.sub],
    );
    if (!result.rows[0]) throw new ApiError(404, "Không tìm thấy tài khoản");
    res.json({ user: publicUser(result.rows[0]) });
  }),
);

module.exports = router;
