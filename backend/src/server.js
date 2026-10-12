const app = require("./app");
const config = require("./config");
const { pool } = require("./db");

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`SportHub API listening on :${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
