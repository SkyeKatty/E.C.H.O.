import type { SttRuntimeConfig } from "@echo/voice-contract";

export async function transcribePcm(
  config: SttRuntimeConfig,
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  groqApiKey: string | null,
): Promise<string> {
  const { pcmToWav } = await import("../pcm-to-wav.js");
  const wav = pcmToWav(pcm, sampleRate, channels);

  if (config.provider === "groq") {
    const key = groqApiKey ?? process.env.GROQ_API_KEY?.trim();
    if (!key) throw new Error("GROQ_API_KEY not configured for STT");
    return transcribeOpenAiCompatible(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      wav,
      config.model || "whisper-large-v3-turbo",
      config.language,
      key,
    );
  }

  const base = config.transcriptionBaseUrl.replace(/\/$/, "");
  const url = `${base}/audio/transcriptions`;
  return transcribeOpenAiCompatible(url, wav, config.model, config.language);
}

async function transcribeOpenAiCompatible(
  url: string,
  wav: Buffer,
  model: string,
  language: string | undefined,
  apiKey?: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "utterance.wav");
  form.append("model", model);
  if (language) form.append("language", language);

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, { method: "POST", headers, body: form });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`STT HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}
