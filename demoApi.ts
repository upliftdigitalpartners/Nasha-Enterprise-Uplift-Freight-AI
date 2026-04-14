/**
 * Demo API service for GitHub Pages deployment.
 *
 * GitHub Pages is static-only — no .NET, no SQL Server, no backend.
 * This module simulates every API call with realistic mock data so
 * the demo is fully interactive without a server.
 *
 * The chatbot uses the Anthropic API directly from the browser
 * (Claude in Claude) so natural-language queries actually work.
 *
 * Toggle between DEMO and PRODUCTION mode via the VITE_MODE env var.
 */

// ── Types ───────────────────────────────────────────────────────

export interface QuoteResult {
  quoteReference: string;
  originPortCode: string;
  originPortName: string;
  destinationPortCode: string;
  destinationPortName: string;
  containerSize: string;
  quantity: number;
  carrierName: string;
  transitDays: number;
  oceanFreightPerContainer: number;
  originTruckingPerContainer: number;
  destinationTruckingPerContainer: number;
  markupPercentage: number;
  markupAmountPerContainer: number;
  fixedFeePerContainer: number;
  totalPerContainer: number;
  grandTotal: number;
  currency: string;
  warnings: string[];
  requiresManualReview: boolean;
}

// ── Mock data matching the real seed ────────────────────────────

const PORTS: Record<string, { code: string; name: string }> = {
  shanghai: { code: "CNSHA", name: "Shanghai" },
  chittagong: { code: "BDCGP", name: "Chittagong" },
  chattogram: { code: "BDCGP", name: "Chittagong" },
  ningbo: { code: "CNNGB", name: "Ningbo" },
  singapore: { code: "SGSIN", name: "Singapore" },
  colombo: { code: "LKCMB", name: "Colombo" },
  rotterdam: { code: "NLRTM", name: "Rotterdam" },
  hamburg: { code: "DEHAM", name: "Hamburg" },
  kolkata: { code: "INKOL", name: "Kolkata" },
  "jebel ali": { code: "AEJEA", name: "Jebel Ali" },
  busan: { code: "KRPUS", name: "Busan" },
};

const RATES: Record<string, { carrier: string; rate: number; transit: number }[]> = {
  "CNSHA-BDCGP-40FT": [
    { carrier: "MSC", rate: 1780, transit: 16 },
    { carrier: "Evergreen", rate: 1810, transit: 15 },
    { carrier: "Maersk", rate: 1850, transit: 14 },
  ],
  "CNSHA-BDCGP-20FT": [
    { carrier: "MSC", rate: 980, transit: 16 },
    { carrier: "Evergreen", rate: 1020, transit: 15 },
    { carrier: "Maersk", rate: 1050, transit: 14 },
  ],
  "CNSHA-BDCGP-40HC": [
    { carrier: "MSC", rate: 1840, transit: 16 },
    { carrier: "Maersk", rate: 1920, transit: 14 },
  ],
  "BDCGP-NLRTM-40FT": [
    { carrier: "MSC", rate: 2380, transit: 30 },
    { carrier: "Maersk", rate: 2450, transit: 28 },
  ],
  "BDCGP-DEHAM-40FT": [
    { carrier: "MSC", rate: 2420, transit: 32 },
    { carrier: "Maersk", rate: 2500, transit: 30 },
  ],
};

const MARKUPS: Record<string, { pct: number; fee: number }> = {
  ZABER: { pct: 8, fee: 25 },
  ARLA: { pct: 10, fee: 30 },
  AKIJ: { pct: 12, fee: 35 },
  CITYLUBE: { pct: 10, fee: 30 },
  OFS: { pct: 10, fee: 30 },
  DEFAULT: { pct: 15, fee: 50 },
};

const TRUCKING: Record<string, number> = {
  "CNSHA-40FT-ORIGIN": 250,
  "CNSHA-20FT-ORIGIN": 180,
  "CNSHA-40HC-ORIGIN": 260,
  "BDCGP-40FT-DESTINATION": 162.9, // pre-converted from 18000 BDT
  "BDCGP-20FT-DESTINATION": 108.6,
  "BDCGP-40HC-DESTINATION": 171.95,
  "NLRTM-40FT-DESTINATION": 380.45, // 350 EUR → USD
  "DEHAM-40FT-DESTINATION": 413.06,
};

// ── Port resolver (simulates the hallucination guard) ───────────

function resolvePort(raw: string): { code: string; name: string } | null {
  const lower = raw.toLowerCase().trim();
  return PORTS[lower] ?? null;
}

// ── LLM parser (regex-based simulation for demo) ────────────────

function parseDemoRequest(text: string): {
  origin: string;
  destination: string;
  containerSize: string;
  quantity: number;
} {
  const lower = text.toLowerCase();

  // Extract quantity
  const qtyMatch = lower.match(/(\d+)\s*[x×]\s*/);
  const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;

  // Extract container size
  let containerSize = "40FT";
  if (lower.includes("20")) containerSize = "20FT";
  else if (lower.includes("40hc") || lower.includes("40'hc") || lower.includes("high cube"))
    containerSize = "40HC";
  else if (lower.includes("40")) containerSize = "40FT";

  // Extract ports
  let origin = "";
  let destination = "";

  const fromMatch = lower.match(/from\s+(\w[\w\s]*?)(?:\s+to\s+|\s*,)/);
  const toMatch = lower.match(/to\s+(\w[\w\s]*?)(?:\s*,|\s*$|\s+\d)/);

  if (fromMatch) origin = fromMatch[1].trim();
  if (toMatch) destination = toMatch[1].trim();

  // Fallback: scan for known port names
  if (!origin || !destination) {
    const knownPorts = Object.keys(PORTS);
    const found: string[] = [];
    for (const p of knownPorts) {
      if (lower.includes(p)) found.push(p);
    }
    if (found.length >= 2) {
      origin = origin || found[0];
      destination = destination || found[1];
    } else if (found.length === 1) {
      origin = origin || found[0];
    }
  }

  return { origin, destination, containerSize, quantity };
}

// ── Main quote generation ───────────────────────────────────────

export function generateDemoQuote(
  rawText: string,
  clientCode: string
): { success: boolean; quote?: QuoteResult; errors: string[] } {
  const parsed = parseDemoRequest(rawText);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Resolve ports
  const originPort = resolvePort(parsed.origin);
  if (!originPort) {
    return {
      success: false,
      errors: [
        `Origin port '${parsed.origin || "(empty)"}' is not recognised. ` +
          `It may not exist in our database or the AI misunderstood the request.`,
      ],
    };
  }

  const destPort = resolvePort(parsed.destination);
  if (!destPort) {
    return {
      success: false,
      errors: [
        `Destination port '${parsed.destination || "(empty)"}' is not recognised. ` +
          `It may not exist in our database or the AI misunderstood the request.`,
      ],
    };
  }

  // Find rates
  const rateKey = `${originPort.code}-${destPort.code}-${parsed.containerSize}`;
  const rates = RATES[rateKey];

  if (!rates || rates.length === 0) {
    return {
      success: false,
      errors: [
        `No active carrier rates found for ${originPort.name} → ${destPort.name} ` +
          `[${parsed.containerSize}]. Please contact the rates desk.`,
      ],
    };
  }

  const best = rates[0]; // cheapest first
  const markup = MARKUPS[clientCode] ?? MARKUPS.DEFAULT;

  const originTruck =
    TRUCKING[`${originPort.code}-${parsed.containerSize}-ORIGIN`] ?? 0;
  const destTruck =
    TRUCKING[`${destPort.code}-${parsed.containerSize}-DESTINATION`] ?? 0;

  if (destTruck > 0 && destPort.code === "BDCGP") {
    warnings.push("Destination trucking converted from BDT at 0.00905 rate");
  }

  const markupAmt = Math.round(best.rate * (markup.pct / 100) * 100) / 100;
  const totalPerContainer =
    Math.round((best.rate + originTruck + destTruck + markupAmt + markup.fee) * 100) / 100;
  const grandTotal = Math.round(totalPerContainer * parsed.quantity * 100) / 100;

  const ref = `Q-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    success: true,
    errors: [],
    quote: {
      quoteReference: ref,
      originPortCode: originPort.code,
      originPortName: originPort.name,
      destinationPortCode: destPort.code,
      destinationPortName: destPort.name,
      containerSize: parsed.containerSize,
      quantity: parsed.quantity,
      carrierName: best.carrier,
      transitDays: best.transit,
      oceanFreightPerContainer: best.rate,
      originTruckingPerContainer: originTruck,
      destinationTruckingPerContainer: destTruck,
      markupPercentage: markup.pct,
      markupAmountPerContainer: markupAmt,
      fixedFeePerContainer: markup.fee,
      totalPerContainer,
      grandTotal,
      currency: "USD",
      warnings,
      requiresManualReview: warnings.length > 0,
    },
  };
}

// ── Mock login ──────────────────────────────────────────────────

const DEMO_USERS: Record<string, { fullName: string; role: string; pass: string }> = {
  "admin": { fullName: "System Administrator", role: "Admin", pass: "admin123" },
  "jakir.rana": { fullName: "Md Jakir Hossain Rana", role: "Manager", pass: "nasha2026" },
  "rahim.khan": { fullName: "Rahim Khan", role: "Agent", pass: "demo" },
  "demo": { fullName: "Demo User", role: "Manager", pass: "demo" },
};

export function demoLogin(username: string, password: string) {
  const user = DEMO_USERS[username];
  if (!user || user.pass !== password) {
    return { success: false, error: "Invalid username or password" };
  }
  return {
    success: true,
    accessToken: "demo-jwt-token",
    user: {
      id: crypto.randomUUID(),
      username,
      fullName: user.fullName,
      email: `${username}@nasha.bd`,
      role: user.role,
      language: "en",
      preferredCurrency: "BDT",
      theme: "light",
    },
  };
}

// ── Mock chatbot (returns canned responses for demo) ────────────

export function demoChatbot(message: string, lang: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("arla") && (lower.includes("import") || lower.includes("ইমপোর্ট"))) {
    return lang === "bn"
      ? "এই সপ্তাহে আরলা ফুড বাংলাদেশের ৬টি ইমপোর্ট জব পাওয়া গেছে: #৪১-#৪৫ (অনুমোদিত/ক্লিয়ার) এবং #৪৬ (কোটেড)।"
      : "Found 6 Arla Food import jobs this week: #41-#45 (Approved/Cleared) and #46 (Quoted).";
  }
  if (lower.includes("rate") || lower.includes("রেট") || lower.includes("cheapest")) {
    return lang === "bn"
      ? "সবচেয়ে কম রেট: MSC — $১,৭৮০/৪০FT সাংহাই→চট্টগ্রাম, ১৬ দিন ট্রানজিট।"
      : "Best rate: MSC at $1,780 per 40FT container, Shanghai → Chittagong, 16-day transit.";
  }
  if (lower.includes("zaber") || lower.includes("জাবের") || lower.includes("export")) {
    return lang === "bn"
      ? "জাবের এন্ড জুবায়েরের আজকের ৭টি এক্সপোর্ট জব আছে: #৪২৪-#৪৩০। ৩টি ক্লিয়ার, ২টি অনুমোদিত, ১টি কোটেড, ১টি ড্রাফ্ট।"
      : "Zaber & Zubair has 7 export jobs today: #424-#430. 3 Cleared, 2 Approved, 1 Quoted, 1 Draft.";
  }
  if (lower.includes("who") && lower.includes("approv")) {
    return "Jakir Hossain Rana approved quote Q-20260414-7A3F2B at 09:14 UTC today.";
  }

  return lang === "bn"
    ? "আপনি জব, রেট, কোটেশন বা অডিট লগ সম্পর্কে জিজ্ঞাসা করতে পারেন। উদাহরণ: 'আরলার এই সপ্তাহের ইমপোর্ট দেখাও'"
    : "You can ask about jobs, rates, quotes, or audit logs. Example: 'Show Arla imports this week'";
}
