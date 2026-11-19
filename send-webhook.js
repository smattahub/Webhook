// Sends a fake GitHub-style delivery (same headers and signature scheme) for local testing.
// Run:  WEBHOOK_SECRET=<secret> node send-webhook.js [ping|push|pull_request|issues]

const crypto = require("crypto");

const URL = process.env.WEBHOOK_URL || "http://localhost:3000/webhook";
const SECRET = process.env.WEBHOOK_SECRET || "dev-secret";
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
