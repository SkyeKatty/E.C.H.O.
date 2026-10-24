import type { TtsRuntimeConfig } from "@echo/voice-contract";

/** OpenRouter / OpenAI-compatible audio speech when the chosen model supports it. */
export async function synthesizeOpenRouter(
  config: TtsRuntimeConfig,
  text: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ audioBase64: string; mimeType: string }> {
  const res = await fetch(`${config.openRouterBaseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://echo.local",
      "X-Title": "ECHO TTS",
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      input: text,
      voice: "alloy",
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter TTS ${res.status}: ${err.slice(0, 400)}`);
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString("base64"), mimeType };
}
