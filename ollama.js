function createOllamaClient({
  ollamaUrl,
  hiddenModelPrefix,
  maxResponseTokens,
  maxResponseTokensSmall,
  maxResponseChars,
}) {
  async function ollamaModels() {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    const data = await res.json();
    return data.models
      .filter((m) => !m.name.startsWith(hiddenModelPrefix))
      .map((m) => ({
        name: m.name,
        size: m.details.parameter_size,
        family: m.details.family,
      }));
  }

  async function ollamaAllModels() {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    const data = await res.json();
    return data.models.map((m) => ({
      name: m.name,
      size: m.details.parameter_size,
      family: m.details.family,
    }));
  }

  async function ollamaLoadedModels() {
    try {
      const res = await fetch(`${ollamaUrl}/api/ps`);
      if (!res.ok) return [];
      const data = await res.json();
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

    const numPredict = tokenLimit || (model.includes("mistral") ? maxResponseTokensSmall : maxResponseTokens);

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { num_predict: numPredict },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama ${res.status}: ${err.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.message?.content) {
              fullResponse += obj.message.content;
              if (fullResponse.length > maxResponseChars) {
                controller.abort();
                onToken("", true, null);
                return fullResponse.slice(0, maxResponseChars);
              }
              onToken(obj.message.content, obj.done || false);
            }
            if (obj.done) {
              onToken("", true, {
                total_duration: obj.total_duration,
                eval_count: obj.eval_count,
                eval_duration: obj.eval_duration,
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      if (e.name === "AbortError") {
        onToken("", true, null);
        return fullResponse;
      }
      throw e;
    }

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
