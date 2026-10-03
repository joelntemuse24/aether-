import fs from "node:fs";

const apps = JSON.parse(fs.readFileSync(0, "utf8"));
const app = Array.isArray(apps) ? apps.find((row) => row && row.name === "aether") : undefined;
if (!app) {
  console.error("pm2 app aether is not running");
  process.exit(2);
}
const env = app.pm2_env ?? {};
const pid = Number(app.pid ?? env.pm_pid ?? 0);
const restarts = Number(env.restart_time ?? 0);
if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(restarts) || restarts < 0) {
  console.error("pm2 app aether has no pid");
  process.exit(2);
}
process.stdout.write(`${pid} ${restarts}\n`);
