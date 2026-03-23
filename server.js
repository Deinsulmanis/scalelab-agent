process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
require("dotenv").config();
console.log("API KEY EXISTS:", !!process.env.ANTHROPIC_API_KEY);
console.log("API KEY LENGTH:", process.env.ANTHROPIC_API_KEY?.length);
const express      = require("express");
const cors         = require("cors");
const Anthropic    = require("@anthropic-ai/sdk");
const nodemailer   = require("nodemailer");
const path         = require("path");
const fs           = require("fs");

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

async function sendLeadEmail(lead) {
  const formatted = new Date(lead.timestamp).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  await transporter.sendMail({
    from    : `"ScaleLab AI" <${process.env.GMAIL_USER}>`,
    to      : process.env.LEAD_NOTIFY_EMAIL,
    subject : `New Lead: ${lead.name} — ${lead.job_type}`,
    text: `
New lead captured by ScaleLab AI Lead Agent
============================================
Name:      ${lead.name}
Phone:     ${lead.phone}
Job Type:  ${lead.job_type}
Location:  ${lead.location}
Captured:  ${formatted}
============================================
Log in to view all leads: http://localhost:${process.env.PORT || 3000}/api/leads
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
                ["Phone",    lead.phone],
                ["Job Type", lead.job_type],
                ["Location", lead.location],
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
              Sent by ScaleLab AI Lead Response Agent
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

  try {
    await sendLeadEmail(lead);
  } catch (err) {
    console.error("Failed to send lead email:", err.message);
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a friendly, professional lead qualification agent for ScaleLab AI, serving small trade businesses — plumbers, electricians, and HVAC technicians.

Your job is to qualify incoming service leads by collecting these four pieces of information ONE AT A TIME, in order:
1. Job type (e.g., plumbing repair, electrical installation, HVAC service)
2. Location / service area (city or zip code)
3. Customer's full name
4. Customer's phone number

Rules you must follow:
- Ask only ONE question per message — never combine questions.
- Keep every response SHORT (1–3 sentences max).
- Be warm and conversational, not robotic.
- Once you have all four pieces of information, thank the customer and let them know a team member will be in touch shortly.
- If the customer asks something unrelated, briefly redirect them back to the qualification process.
- Never ask for payment info or any sensitive data beyond name and phone.

IMPORTANT — When you have collected all four pieces (job type, location, name, phone), you MUST append the following marker on a new line at the very end of your response, with no extra text after it:
##LEAD##{"name":"<full name>","phone":"<phone number>","job_type":"<job type>","location":"<location>"}

Only append this marker once, on the final confirmation message. Do not include it in any other message.

Start by greeting the customer and asking what type of job they need help with.`;

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
  console.log("API Key being used:", process.env.ANTHROPIC_API_KEY?.substring(0, 20) + "...");
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

      try {
        const leadData = JSON.parse(jsonStr);
        await saveLead({
          ...leadData,
          timestamp: new Date().toISOString(),
        });
      } catch (parseErr) {
        console.error("Failed to parse lead JSON:", jsonStr, parseErr.message);
      }
    }

    res.json({ content: text });

  } catch (err) {
    console.error("Anthropic API error:", err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /api/leads ────────────────────────────────────────────────────────────
app.get("/api/leads", (req, res) => {
  const leads = readLeads();
  res.json(leads);
});

// ── Start server ──────────────────────────────────────────────────────────────
try {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ScaleLab AI server running on port ${PORT}`);
  });
} catch (err) {
  console.error('Failed to start server:', err);
}
