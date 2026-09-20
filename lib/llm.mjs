const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

export function llmAvailable(cfg) {
  return Boolean(cfg?.secrets?.nvidia_api_key || cfg?.secrets?.groq_api_key || cfg?.secrets?.openai_api_key);
}

export async function chat(system, user, cfg, { temperature, maxTokens, timeoutMs = 90000 } = {}) {
  const nv = cfg.secrets.nvidia_api_key;
  let url;
  let key;
  let model;
  if (nv) {
    url = NIM_URL;
    key = nv;
    model = cfg.ai?.model || DEFAULT_MODEL;
  } else if (cfg.secrets.groq_api_key) {
    url = "https://api.groq.com/openai/v1/chat/completions";
    key = cfg.secrets.groq_api_key;
    model = "llama-3.3-70b-versatile";
  } else if (cfg.secrets.openai_api_key) {
    url = "https://api.openai.com/v1/chat/completions";
    key = cfg.secrets.openai_api_key;
    model = "gpt-4o-mini";
  } else {
    throw new Error("No LLM API key configured");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: temperature ?? cfg.ai?.temperature ?? 0.3,
        max_tokens: maxTokens ?? cfg.ai?.max_tokens ?? 2500,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

export function makeLlmChat(cfg, { timeoutMs = 25000, maxTokens = 1800 } = {}) {
  if (!llmAvailable(cfg)) return null;
  return (system, user) => chat(system, user, cfg, { temperature: 0.2, maxTokens, timeoutMs });
}
