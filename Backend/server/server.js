const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const dns = require("dns");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

let OpenAI = null;
try {
  OpenAI = require("openai").OpenAI;
} catch {
  OpenAI = null;
}

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_URI_DIRECT = process.env.MONGO_URI_DIRECT || "";
const DNS_SERVERS = process.env.DNS_SERVERS || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SID = process.env.TWILIO_VERIFY_SID;
const resolveOpenAIKey = (req) =>
  String(
    req?.headers?.["x-openai-key"] ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAPI_API_KEY ||
    process.env.OPEN_AI_API_KEY ||
    process.env.OPENAI_KEY ||
    ""
  ).trim();

const missing = [];
if (!MONGO_URI) missing.push("MONGO_URI");
if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
if (!TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
if (!TWILIO_VERIFY_SID) missing.push("TWILIO_VERIFY_SID");

if (missing.length) {
  console.log("Missing ENV:", missing.join(", "));
  console.log("Check your .env file in Backend/server/");
}
if (!resolveOpenAIKey()) {
  console.log("OPENAI API key missing. AI endpoint will use fallback copy mode.");
}

// Improve DNS stability for Atlas from constrained networks.
dns.setDefaultResultOrder("ipv4first");
if (DNS_SERVERS.trim()) {
  try {
    dns.setServers(
      DNS_SERVERS
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    console.log("Custom DNS servers enabled for Mongo lookup.");
  } catch (err) {
    console.log("Invalid DNS_SERVERS value:", err.message);
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

let twilioClient = null;
try {
  const twilio = require("twilio");
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
} catch {
  console.log("Twilio package not installed. Run: npm i twilio");
}

const isE164 = (phone = "") => /^\+[1-9]\d{7,14}$/.test(String(phone).trim());
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP requests. Please wait and try again." },
});
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP verification attempts. Please wait and retry." },
});
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "AI limit reached. Try again after some time." },
});

function mapTwilioError(err) {
  const raw = String(err?.message || "").toLowerCase();
  const code = err?.code;
  if (raw.includes("unverified") || raw.includes("trial accounts cannot send")) {
    return {
      status: 400,
      error_code: "TRIAL_UNVERIFIED_NUMBER",
      message: "Twilio trial account can send OTP only to verified numbers. Verify this number in Twilio Console.",
    };
  }
  if (code === 21211 || raw.includes("not a valid phone number")) {
    return {
      status: 400,
      error_code: "INVALID_PHONE_NUMBER",
      message: "Invalid phone number. Use format +countrycodeXXXXXXXXXX",
    };
  }
  return {
    status: 500,
    error_code: "TWILIO_SEND_FAILED",
    message: "Failed to send OTP. Check Twilio configuration and phone format.",
  };
}

app.post("/api/auth/send-otp", otpSendLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "phone required" });
    if (!isE164(phone)) return res.status(400).json({ message: "Invalid phone format. Use +countrycodeXXXXXXXXXX" });

    if (!twilioClient) {
      return res.status(500).json({ message: "Twilio client not ready. Install/configure Twilio." });
    }
    if (!TWILIO_VERIFY_SID) {
      return res.status(500).json({ message: "TWILIO_VERIFY_SID missing in .env" });
    }

    const result = await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SID)
      .verifications.create({ to: phone, channel: "sms" });

    return res.json({ status: result.status, message: "OTP sent successfully" });
  } catch (err) {
    const mapped = mapTwilioError(err);
    return res.status(mapped.status).json({
      message: mapped.message,
      error_code: mapped.error_code,
    });
  }
});

app.post("/api/auth/verify-otp", otpVerifyLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ message: "phone and code required" });
    if (!isE164(phone)) return res.status(400).json({ message: "Invalid phone format." });
    if (!/^\d{4,8}$/.test(String(code).trim())) return res.status(400).json({ message: "Invalid OTP code format." });

    if (!twilioClient) {
      return res.status(500).json({ message: "Twilio client not ready. Install/configure Twilio." });
    }
    if (!TWILIO_VERIFY_SID) {
      return res.status(500).json({ message: "TWILIO_VERIFY_SID missing in .env" });
    }

    const check = await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status === "approved") {
      return res.json({ verified: true, message: "OTP verified" });
    }
    return res.status(400).json({ verified: false, message: "Invalid OTP" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to verify OTP. Please retry." });
  }
});

app.post("/api/templates/assist", aiLimiter, async (req, res) => {
  try {
    const {
      brand = "Code Sanskriti",
      category = "Landing",
      style = "Modern",
      theme = "dark",
      accent = "#0ea5e9",
    } = req.body || {};

    const fallbackCopy = {
      headline: `${brand}: ${style} ${category} experience`,
      subheadline:
        theme === "dark"
          ? "Professional dark-mode layout with clear contrast and strong CTA focus."
          : "Professional light-mode layout with clear hierarchy and high readability.",
      primaryCta: "Get Started",
      secondaryCta: "Learn More",
      cardTitle: `${style} UI`,
      cardNote: `Accent: ${accent}`,
    };

    const openaiKey = resolveOpenAIKey(req);
    const openaiClient = OpenAI && openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

    if (!openaiClient) {
      return res.json({
        ok: true,
        copy: fallbackCopy,
        mode: "config_missing",
        message: "OPENAI_API_KEY missing in Backend/server/.env",
      });
    }

    const prompt = `Create short website copy for a landing hero. Return ONLY valid JSON with keys: headline, subheadline, primaryCta, secondaryCta, cardTitle, cardNote.\n\nBrand: ${brand}\nCategory: ${category}\nStyle: ${style}\nTheme: ${theme}\nAccent: ${accent}\n\nConstraints:\n- headline max 60 chars\n- subheadline max 120 chars\n- CTA labels 1-3 words\n- professional tone`;

    const modelCandidates = [
      process.env.OPENAI_MODEL || "gpt-4o-mini",
      "gpt-4.1-mini",
      "gpt-4o",
    ];
    let response = null;
    let lastErr = null;
    for (const model of modelCandidates) {
      try {
        response = await openaiClient.chat.completions.create({
          model,
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        });
        if (response) break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!response) {
      throw lastErr || new Error("No compatible OpenAI model available.");
    }

    const raw = response?.choices?.[0]?.message?.content || "{}";
    let copy;
    try {
      copy = JSON.parse(raw);
    } catch {
      return res.status(502).json({ message: "AI response parsing failed." });
    }

    return res.json({ ok: true, copy, mode: "openai" });
  } catch (err) {
    const message =
      String(err?.message || "OpenAI request failed")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
    return res.json({
      ok: true,
      mode: "error",
      message,
      copy: {
        headline: "Smart template for your project",
        subheadline: "Readable, conversion-focused section blocks with balanced spacing.",
        primaryCta: "Get Started",
        secondaryCta: "Contact",
        cardTitle: "Animated Card",
        cardNote: "Fallback copy mode enabled",
      },
    });
  }
});

async function start() {
  try {
    if (!MONGO_URI) {
      console.log("MongoDB not connected because MONGO_URI is missing.");
      app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
      return;
    }

    const candidates = [MONGO_URI, MONGO_URI_DIRECT].filter(Boolean);
    let connected = false;
    let lastError = null;

    for (const uri of candidates) {
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 10000,
        });
        connected = true;
        console.log(
          `MongoDB connected using ${uri.startsWith("mongodb+srv://") ? "SRV URI" : "direct URI"}`,
        );
        break;
      } catch (err) {
        lastError = err;
        console.log("MongoDB connection attempt failed:", err.message);
      }
    }

    if (!connected) {
      const msg = String(lastError?.message || "");
      if (msg.includes("querySrv ECONNREFUSED")) {
        console.log("Hint: SRV DNS blocked. Set MONGO_URI_DIRECT in .env from Atlas Drivers > Node.js.");
        console.log("Hint: Optionally set DNS_SERVERS=8.8.8.8,1.1.1.1 in .env.");
      } else if (msg.toLowerCase().includes("authentication failed")) {
        console.log("Hint: Atlas username/password mismatch.");
      } else if (msg.toLowerCase().includes("ip")) {
        console.log("Hint: Add your current IP in Atlas Network Access.");
      }
      app.listen(PORT, () => console.log(`Server running on port ${PORT} (DB not connected)`));
      return;
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.log("MongoDB startup error:", err.message);
    app.listen(PORT, () => console.log(`Server running on port ${PORT} (DB not connected)`));
  }
}

start();
