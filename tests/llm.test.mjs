import test from "node:test";
import assert from "node:assert/strict";
import { chatRequestBody, applySseDataLine, llmProviders } from "../lib/llm.mjs";

test("provider order is Groq then NVIDIA then OpenAI", () => {
  const providers = llmProviders({
    secrets: {
      nvidia_api_key: "n",
      groq_api_key: "g",
      openai_api_key: "o",
    },
  });
  assert.deepEqual(
    providers.map((p) => p.id),
    ["groq", "nvidia", "openai"]
  );
});

test("NIM request streams and caps reasoning so apply does not hang", () => {
  const body = chatRequestBody("sys", "user", {
    secrets: { nvidia_api_key: "x" },
    ai: {
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      reasoning_budget: 1024,
      max_tokens: 4096,
      enable_thinking: true,
    },
  });
  assert.equal(body.stream, true);
  assert.equal(body.reasoning_budget, 1024);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.chat_template_kwargs.enable_thinking, true);
  assert.equal(body.chat_template_kwargs.reasoning_budget, 1024);
});

test("NIM can turn thinking off for structured JSON", () => {
  const body = chatRequestBody("s", "u", {
    secrets: { nvidia_api_key: "x" },
    ai: { enable_thinking: false, max_tokens: 512 },
  });
  assert.equal(body.stream, true);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(body.reasoning_budget, undefined);
});

test("Groq request omits NVIDIA thinking fields", () => {
  const body = chatRequestBody("s", "u", {
    secrets: { groq_api_key: "x" },
    ai: { reasoning_budget: 1024 },
  });
  assert.equal(body.stream, false);
  assert.equal(body.reasoning_budget, undefined);
  assert.equal(body.chat_template_kwargs, undefined);
});

test("SSE deltas accumulate content separate from reasoning", () => {
  const acc = { content: "", reasoning: "", finish: "" };
  applySseDataLine('{"choices":[{"delta":{"reasoning":"think"}}]}', acc);
  applySseDataLine('{"choices":[{"delta":{"content":"{\\"ok\\":"}}]}', acc);
  applySseDataLine('{"choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}]}', acc);
  assert.equal(acc.content, '{"ok":true}');
  assert.equal(acc.reasoning, "think");
  assert.equal(acc.finish, "stop");
});
