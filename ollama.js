const { Ollama } = require("ollama");

const OLLAMA_API_TIMEOUT_MS = 15_000; // 15s for metadata calls
const OLLAMA_CHAT_TIMEOUT_MS = 5 * 60_000; // 5 min for streaming chat

function createOllamaClient({
  ollamaUrl,
  hiddenModelPrefix,
  maxResponseTokens,
  maxResponseTokensSmall,
  maxResponseChars,
}) {
  const client = new Ollama({ host: ollamaUrl });

  async function ollamaModels() {
    const data = await client.list({ signal: AbortSignal.timeout(OLLAMA_API_TIMEOUT_MS) });
    return data.models
      .filter((m) => !m.name.startsWith(hiddenModelPrefix))
      .map((m) => ({
        name: m.name,
        size: m.details.parameter_size,
        family: m.details.family,
      }));
  }

  async function ollamaAllModels() {
    const data = await client.list({ signal: AbortSignal.timeout(OLLAMA_API_TIMEOUT_MS) });
    return data.models.map((m) => ({
      name: m.name,
      size: m.details.parameter_size,
      family: m.details.family,
    }));
  }

  async function ollamaLoadedModels() {
    try {
      const data = await client.ps({ signal: AbortSignal.timeout(OLLAMA_API_TIMEOUT_MS) });
      return (data.models || []).map((model) => ({
        name: model.name,
        size: model.size || null,
        expiresAt: model.expires_at || null,
        sizeVram: model.size_vram || null,
      }));
    } catch {
      return [];
    }
  }

  async function ollamaChat(model, messages, onToken, abortSignal, tokenLimit) {
    const controller = new AbortController();
    if (abortSignal) {
      const onAbort = () => controller.abort();
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // Global timeout: abort if chat takes too long overall
    const chatTimer = setTimeout(() => controller.abort(), OLLAMA_CHAT_TIMEOUT_MS);

    const numPredict = tokenLimit || (model.includes("mistral") ? maxResponseTokensSmall : maxResponseTokens);

    let fullResponse = "";

    try {
      const stream = await client.chat({
        model,
        messages,
        stream: true,
        options: { num_predict: numPredict },
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        if (chunk.message?.content) {
          fullResponse += chunk.message.content;
          if (fullResponse.length > maxResponseChars) {
            controller.abort();
            onToken("", true, null);
            clearTimeout(chatTimer);
            return fullResponse.slice(0, maxResponseChars);
          }
          onToken(chunk.message.content, chunk.done || false);
        }
        if (chunk.done) {
          onToken("", true, {
            total_duration: chunk.total_duration,
            eval_count: chunk.eval_count,
            eval_duration: chunk.eval_duration,
          });
        }
      }
    } catch (e) {
      clearTimeout(chatTimer);
      if (e.name === "AbortError") {
        onToken("", true, null);
        return fullResponse;
      }
      throw e;
    }

    clearTimeout(chatTimer);
    return fullResponse;
  }

  return {
    ollamaModels,
    ollamaAllModels,
    ollamaLoadedModels,
    ollamaChat,
  };
}

module.exports = {
  createOllamaClient,
};
