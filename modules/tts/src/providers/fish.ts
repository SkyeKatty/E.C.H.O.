import { encode } from "@msgpack/msgpack";
import type { TtsRuntimeConfig } from "@echo/voice-contract";

/** Fish Audio Fish Speech — POST /v1/tts with msgpack body (see speech.fish.audio/server). */
export async function synthesizeFish(
  config: TtsRuntimeConfig,
  text: string,
  signal?: AbortSignal,
): Promise<{ audioBase64: string; mimeType: string }> {
  const url = new URL(config.fishApiPath, config.fishBaseUrl);
  url.searchParams.set("format", "msgpack");

  const referenceId = process.env.ECHO_FISH_REFERENCE_ID?.trim();
  const payload: Record<string, unknown> = {
    text,
    format: "wav",
    references: [],
    streaming: false,
    normalize: true,
    use_memory_cache: "off",
    chunk_length: 200,
    latency: "normal",
  };
  if (referenceId) payload.reference_id = referenceId;

  const apiKey = process.env.ECHO_FISH_API_KEY?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/msgpack",
    Accept: "audio/*",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: Buffer.from(encode(payload)),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fish Speech TTS ${res.status}: ${err.slice(0, 300)}`);
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || config.defaultMimeType;
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString("base64"), mimeType };
}
