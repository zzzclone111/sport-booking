const test = require("node:test");
const assert = require("node:assert/strict");
process.env.LOG_LEVEL = "silent";
const app = require("../src/app");
const { pool } = require("../src/db");

let server;
let baseUrl;

test.before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    }),
);

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test("liveness endpoint does not depend on the database", async () => {
  const response = await fetch(`${baseUrl}/health/live`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("protected renter endpoint requires a token", async () => {
  const response = await fetch(`${baseUrl}/api/bookings/my`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.message, "Vui lòng đăng nhập");
});

test("unknown routes return a consistent JSON error", async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).message, /Không tìm thấy/);
});
