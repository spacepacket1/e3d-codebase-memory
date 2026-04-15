async function sendAnthropicPrompt({ model, promptText, systemPrompt, maxTokens = 1200, temperature = 0 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt || undefined,
      messages: [
        {
          role: "user",
          content: promptText
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error("Anthropic authentication failed");
    }
    if (response.status === 429) {
      throw new Error("Anthropic rate limit or quota exceeded");
    }
    throw new Error(`Anthropic request failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = Array.isArray(payload.content) ? payload.content : [];
  const text = content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic returned an empty response");
  }

  return {
    text,
    model: payload.model || model,
    usage: payload.usage || null,
    raw: payload
  };
}

module.exports = {
  sendAnthropicPrompt
};
