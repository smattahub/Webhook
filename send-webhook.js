// Sends a fake GitHub-style delivery (same headers and signature scheme) for local testing.
// Run:  node send-webhook.js [ping|push|pull_request|issues]
//
// The secret comes from WEBHOOK_SECRET if set, otherwise from the .env file that
// start.sh creates next to this script. Never put a real secret in this file:
// it is committed to git.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Reads WEBHOOK_SECRET from .env (a "WEBHOOK_SECRET=..." line), or returns undefined.
function secretFromEnvFile() {
  try {
    const text = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    const match = text.match(/^\s*WEBHOOK_SECRET\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/m);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

const URL = process.env.WEBHOOK_URL || "http://localhost:3000/webhook";
const SECRET = process.env.WEBHOOK_SECRET || secretFromEnvFile();
if (!SECRET) {
  console.error("No secret found. Run ./start.sh once to create .env, or set WEBHOOK_SECRET.");
  process.exit(1);
}
const event = process.argv[2] || "ping";

const repository = { full_name: "octo-org/hello-world" };
const sender = { login: "octocat" };

const samples = {
  ping: { zen: "Keep it logically awesome.", hook_id: 12345, repository, sender },
  push: {
    ref: "refs/heads/main",
    repository,
    sender,
    pusher: { name: "octocat" },
    commits: [
      { id: "a1b2c3d4e5f6a7b8", message: "Fix login bug\n\nDetails here" },
      { id: "0f9e8d7c6b5a4f3e", message: "Update README" },
    ],
  },
  pull_request: {
    action: "opened",
    number: 42,
    pull_request: { title: "Add dark mode" },
    repository,
    sender,
  },
  issues: { action: "opened", issue: { number: 7, title: "Crash on startup" }, repository, sender },
};

const body = JSON.stringify(samples[event] || { repository, sender });
const signature = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

fetch(URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "GitHub-Hookshot/test",
    "X-GitHub-Event": event,
    "X-GitHub-Delivery": crypto.randomUUID(),
    "X-Hub-Signature-256": signature,
  },
  body,
})
  .then(async (r) => console.log(r.status, await r.text()))
  .catch((e) => console.error("Request failed:", e.message));
