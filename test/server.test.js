const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, escapeHtml, chatSchema } = require("../server");

const env = {
  ALLOWED_ORIGINS: "https://scalelabai.ca",
  LEADS_API_KEY: "test-key",
  TWILIO_FROM_NUMBER: "+15555550100",
  LEAD_NOTIFY_PHONE: "+16048369902",
};

function setup(content) {
  const saved = [];
  const store = {
    async save(lead) { if (saved.some((item) => item.conversationId === lead.conversationId)) return false; saved.push(lead); return true; },
    async updateStatus() {}, async recordSms() {}, async updateSmsDelivery() {}, async list() { return saved; },
  };
  const services = {
    anthropic: { messages: { async create() { if (content instanceof Error) throw content; return { content }; } } },
    mailer: { async sendMail() {} },
    smsClient: { messages: { async create() { return { sid: "SM-test" }; } } },
  };
  const { app } = createApp({ env, services, store });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, saved, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function post(base, body) {
  return fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://scalelabai.ca" }, body: JSON.stringify(body) });
}

test("escapes untrusted lead content", () => {
  assert.equal(escapeHtml('<img onerror="x">'), "&lt;img onerror=&quot;x&quot;&gt;");
});

test("rejects malformed and oversized chat requests", async () => {
  const context = setup([{ type: "text", text: "unused" }]);
  try {
    assert.equal((await post(context.base, { messages: [] })).status, 400);
    assert.equal(chatSchema.safeParse({ conversationId: crypto.randomUUID(), messages: [{ role: "user", content: "x".repeat(2001) }] }).success, false);
  } finally { await context.close(); }
});

test("captures a validated structured lead once", async () => {
  const context = setup([
    { type: "text", text: "Thanks — your details are confirmed." },
    { type: "tool_use", name: "capture_qualified_lead", input: { name: "Test Lead", email: "TEST@EXAMPLE.COM", phone: "+16045550123", business: "Dental practice", interest: "Missed calls" } },
  ]);
  const body = { conversationId: crypto.randomUUID(), messages: [{ role: "user", content: "I confirm those details." }] };
  try {
    const first = await post(context.base, body);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).leadCaptured, true);
    const second = await post(context.base, body);
    assert.equal((await second.json()).leadCaptured, false);
    assert.equal(context.saved.length, 1);
    assert.equal(context.saved[0].email, "test@example.com");
  } finally { await context.close(); }
});

test("does not expose provider errors", async () => {
  const context = setup(new Error("secret provider detail"));
  try {
    const response = await post(context.base, { conversationId: crypto.randomUUID(), messages: [{ role: "user", content: "Hello" }] });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "The assistant is temporarily unavailable. Please try again shortly." });
  } finally { await context.close(); }
});

test("protects lead listing with a bearer token", async () => {
  const context = setup([{ type: "text", text: "Hello" }]);
  try {
    assert.equal((await fetch(`${context.base}/api/leads`)).status, 401);
    assert.equal((await fetch(`${context.base}/api/leads`, { headers: { Authorization: "Bearer test-key" } })).status, 200);
  } finally { await context.close(); }
});
