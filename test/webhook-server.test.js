// Run with: npm test   (uses Node's built-in test runner, no dependencies)

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createServer, isValidSignature, parsePayload } = require("../webhook-server");

const SECRET = "test-secret";
const sign = (body, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

// Starts a server on a random port with handlers that record what they receive.
async function startServer() {
  const calls = [];
  const record = (name) => (payload) => calls.push({ name, payload });
  const server = createServer({
    secret: SECRET,
    handlers: { ping: record("ping"), push: record("push"), boom: () => { throw new Error("boom"); } },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, url, calls };
}

function deliver(url, { event = "ping", body = "{}", signature = sign(body), contentType = "application/json" } = {}) {
  const headers = { "Content-Type": contentType, "X-GitHub-Delivery": "test-delivery" };
  if (event) headers["X-GitHub-Event"] = event;
  if (signature) headers["X-Hub-Signature-256"] = signature;
  return fetch(`${url}/webhook`, { method: "POST", headers, body });
}

// Handlers run after the response is sent, so give them a tick to finish.
const settle = () => new Promise((r) => setImmediate(r));

test("isValidSignature accepts a correct signature", () => {
  assert.equal(isValidSignature(SECRET, Buffer.from("hello"), sign("hello")), true);
});

test("isValidSignature rejects wrong secret, missing, and malformed headers", () => {
  const body = Buffer.from("hello");
  assert.equal(isValidSignature(SECRET, body, sign("hello", "other")), false);
  assert.equal(isValidSignature(SECRET, body, undefined), false);
  assert.equal(isValidSignature(SECRET, body, "sha1=abc"), false);
  assert.equal(isValidSignature(SECRET, body, "sha256=nothex"), false);
});

test("parsePayload handles JSON and form-encoded bodies", () => {
  assert.deepEqual(parsePayload(Buffer.from('{"a":1}'), "application/json"), { a: 1 });
  const form = "payload=" + encodeURIComponent('{"a":2}');
  assert.deepEqual(parsePayload(Buffer.from(form), "application/x-www-form-urlencoded"), { a: 2 });
});

test("createServer requires a secret", () => {
  assert.throws(() => createServer({}), /secret is required/);
});

test("server", async (t) => {
  const { server, url, calls } = await startServer();
  t.after(() => server.close());

  await t.test("GET /health returns ok", async () => {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  await t.test("signed delivery is accepted and dispatched", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main", commits: [] });
    const res = await deliver(url, { event: "push", body });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { received: true, event: "push", delivery: "test-delivery" });
    await settle();
    assert.equal(calls.at(-1).name, "push");
    assert.equal(calls.at(-1).payload.ref, "refs/heads/main");
  });

  await t.test("form-encoded delivery is accepted", async () => {
    const body = "payload=" + encodeURIComponent('{"zen":"hi"}');
    const res = await deliver(url, { body, contentType: "application/x-www-form-urlencoded" });
    assert.equal(res.status, 202);
    await settle();
    assert.equal(calls.at(-1).payload.zen, "hi");
  });

  await t.test("bad signature is rejected with 401 and not dispatched", async () => {
    const before = calls.length;
    const res = await deliver(url, { body: "{}", signature: sign("{}", "wrong") });
    assert.equal(res.status, 401);
    await settle();
    assert.equal(calls.length, before);
  });

  await t.test("missing signature is rejected with 401", async () => {
    const res = await deliver(url, { signature: null });
    assert.equal(res.status, 401);
  });

  await t.test("missing event header is rejected with 400", async () => {
    const res = await deliver(url, { event: null });
    assert.equal(res.status, 400);
  });

  await t.test("invalid JSON is rejected with 400", async () => {
    const res = await deliver(url, { body: "not json" });
    assert.equal(res.status, 400);
  });

  await t.test("unknown event is still acknowledged", async () => {
    const res = await deliver(url, { event: "star" });
    assert.equal(res.status, 202);
  });

  await t.test("a failing handler does not crash the server", async () => {
    const res = await deliver(url, { event: "boom" });
    assert.equal(res.status, 202);
    await settle();
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
  });

  await t.test("other paths return 404", async () => {
    const res = await fetch(`${url}/nope`);
    assert.equal(res.status, 404);
  });
});
