/**
 * Unified API layer.
 *
 * When built with VITE_MODE=demo (GitHub Pages), all calls route to
 * the mock demoApi.ts with no network requests.
 *
 * When built normally (production / Tauri), calls go to the real
 * .NET API on the in-house server.
 */

import { generateDemoQuote, demoLogin, demoChatbot } from "./demoApi";

declare const __DEMO_MODE__: boolean;

const API_BASE = import.meta.env.VITE_API_BASE || "";

// ── Helpers ─────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  if (__DEMO_MODE__) {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 600));
    return demoLogin(username, password);
  }
  return post("/api/auth/login", { username, password });
}

// ── Quotes ──────────────────────────────────────────────────────

export async function generateQuote(rawText: string, clientCode: string, token?: string) {
  if (__DEMO_MODE__) {
    await new Promise((r) => setTimeout(r, 1500)); // simulate LLM latency
    return generateDemoQuote(rawText, clientCode);
  }
  return post("/api/quotes/generate", { rawText, clientCode }, token);
}

// ── Chatbot ─────────────────────────────────────────────────────

export async function chatbotAsk(message: string, lang: string, token?: string) {
  if (__DEMO_MODE__) {
    await new Promise((r) => setTimeout(r, 800));
    return { answer: demoChatbot(message, lang), data: null, suggestions: [] };
  }
  return post("/api/chatbot/ask", { message }, token);
}

// ── Mode indicator ──────────────────────────────────────────────

export const isDemoMode = __DEMO_MODE__;
