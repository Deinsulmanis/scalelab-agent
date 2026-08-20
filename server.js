process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
require("dotenv").config();
const express      = require("express");
const cors         = require("cors");
const Anthropic    = require("@anthropic-ai/sdk");
const nodemailer   = require("nodemailer");
const twilio       = require("twilio");
const path         = require("path");
const fs           = require("fs");
const crypto       = require("crypto");

const app    = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Mailer ────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const smsConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  from: process.env.TWILIO_FROM_NUMBER,
  to: process.env.LEAD_NOTIFY_PHONE,
};
const smsClient = smsConfig.accountSid && smsConfig.authToken
  ? twilio(smsConfig.accountSid, smsConfig.authToken)
  : null;

async function sendLeadEmail(lead) {
  const formatted = new Date(lead.timestamp).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  await transporter.sendMail({
    from    : `"ScaleLab AI" <${process.env.GMAIL_USER}>`,
    to      : process.env.LEAD_NOTIFY_EMAIL,
    subject : `New Lead: ${lead.name} — ${lead.interest}`,
    text: `
New lead captured by ScaleLab AI
============================================
Name:      ${lead.name}
Email:     ${lead.email}
Business:  ${lead.business}
Interest:  ${lead.interest}
Captured:  ${formatted}
============================================
Lead data is available only through authenticated API access.
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fa;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#020D18;border-radius:12px;overflow:hidden;border:1px solid #0d2440;">

        <!-- Header -->
        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid #0d2440;">
            <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#00D4FF;">ScaleLab AI</p>
            <h1 style="margin:6px 0 0;font-size:20px;color:#e8f4f8;">New Lead Captured</h1>
          </td>
        </tr>

        <!-- Lead details -->
        <tr>
          <td style="padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${[
                ["Name",     lead.name],
                ["Email",    lead.email],
                ["Business", lead.business],
                ["Interest", lead.interest],
                ["Captured", formatted],
              ].map(([label, value]) => `
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #0d2440;
                           font-size:12px;color:#7da8be;width:90px;vertical-align:top;">
                  ${label}
                </td>
                <td style="padding:10px 0;border-bottom:1px solid #0d2440;
                           font-size:14px;color:#e8f4f8;font-weight:600;">
                  ${value}
                </td>
              </tr>`).join("")}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#071a2e;text-align:center;">
            <p style="margin:0;font-size:11px;color:#7da8be;">
              Sent by ScaleLab AI
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });

  console.log(`Lead email sent to ${process.env.LEAD_NOTIFY_EMAIL}`);
}

async function sendLeadSms(lead) {
  if (!smsClient || !smsConfig.from || !smsConfig.to) {
    console.warn("SMS notification skipped: Twilio is not fully configured");
    return false;
  }

  const formatted = new Date(lead.timestamp).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.LEAD_NOTIFY_TIMEZONE || "America/Vancouver",
  });

  const message = await smsClient.messages.create({
    from: smsConfig.from,
    to: smsConfig.to,
    body: [
      "New qualified ScaleLab AI lead",
      `Name: ${lead.name}`,
      `Email: ${lead.email}`,
      `Business: ${lead.business}`,
      `Interest: ${lead.interest}`,
      `Captured: ${formatted}`,
    ].join("\n"),
  });

  console.log(`Lead SMS accepted by Twilio: ${message.sid}`);
  return true;
}

// ── Leads file ───────────────────────────────────────────────────────────────
const LEADS_FILE = path.join(__dirname, "leads.json");

function readLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); }
  catch { return []; }
}

async function saveLead(lead) {
  const leads = readLeads();
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log("Lead saved:", lead);

  const notifications = await Promise.allSettled([
    sendLeadEmail(lead),
    sendLeadSms(lead),
  ]);
  const [emailResult, smsResult] = notifications;
  if (emailResult.status === "rejected") {
    console.error("Failed to send lead email:", emailResult.reason?.message || "Unknown error");
  }
  if (smsResult.status === "rejected") {
    console.error("Failed to send lead SMS:", smsResult.reason?.message || "Unknown error");
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI assistant for ScaleLab AI, a company that builds AI receptionists, automated lead response systems, and custom websites for growing businesses.

Your job is to qualify inbound leads by having a short, friendly conversation. Follow these steps in order:

1. Greet the visitor warmly and ask what brought them to ScaleLab AI today.
2. Find out what type of business they run (e.g. real estate, home services, medical, legal, etc.).
3. Ask what their biggest challenge is — choosing from: missing leads after hours, slow follow-up, no website, or wanting to automate their operations.
4. Based on their answer, briefly mention which ScaleLab AI service fits best (AI receptionist, lead automation, or website build) — keep it to one sentence.
5. Ask for their name and best email address so the team can send over a custom plan.
6. Thank them and let them know the ScaleLab AI team will be in touch within 24 hours with a tailored strategy.

Rules:
- Keep every response short and conversational — 1-3 sentences max.
- Ask only one question at a time.
- Never mention pricing.
- Sound like a knowledgeable human team member, not a bot.

IMPORTANT — Once you have collected all four pieces of information (business type, main challenge, name, email), you MUST append the following marker on a new line at the very end of your final confirmation message, with no extra text after it:
##LEAD##{"name":"<full name>","email":"<email address>","business":"<business type>","interest":"<what they need>"}

Only append this marker once, on the final confirmation message. Do not include it in any other message.`;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("widget.js")) {
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
  }
}));

// ── POST /api/chat ────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  console.log("Received chat request");
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const response = await client.messages.create({
      model      : "claude-haiku-4-5-20251001",
      max_tokens : 512,
      system     : SYSTEM_PROMPT,
      messages   : messages,
    });

    let text = response.content[0]?.text || "";

    // ── Extract and strip lead marker if present ──────────────────────────────
    const MARKER = "##LEAD##";
    const markerIndex = text.indexOf(MARKER);

    if (markerIndex !== -1) {
      const jsonStr = text.slice(markerIndex + MARKER.length).trim();
      text = text.slice(0, markerIndex).trim();

      // Fire-and-forget — don't block the response waiting for email/disk I/O
      setImmediate(() => {
        try {
          const leadData = JSON.parse(jsonStr);
          saveLead({ ...leadData, timestamp: new Date().toISOString() })
            .catch(err => console.error("Failed to save lead:", err.message));
        } catch (parseErr) {
          console.error("Failed to parse lead JSON:", jsonStr, parseErr.message);
        }
      });
    }

    res.json({ content: text });

  } catch (error) {
    console.error("Chat error:", error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

// ── GET /api/leads ────────────────────────────────────────────────────────────
app.get("/api/leads", (req, res) => {
  const configuredKey = process.env.LEADS_API_KEY;
  const suppliedKey = req.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!configuredKey) {
    return res.status(503).json({ error: "Lead access is not configured" });
  }

  const configured = Buffer.from(configuredKey);
  const supplied = Buffer.from(suppliedKey || "");
  if (configured.length !== supplied.length || !crypto.timingSafeEqual(configured, supplied)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const leads = readLeads();
  res.json(leads);
});

// ── Start server ──────────────────────────────────────────────────────────────
try {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Beacon server running on port ${PORT}`);
  });
} catch (err) {
  console.error('Failed to start server:', err);
}
