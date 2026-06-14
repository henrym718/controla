/** Transcribe audio con la API de Whisper (OpenAI). */
export async function transcribe(
  audio: Blob,
  filename = "audio.webm",
): Promise<string> {
  const key = process.env.WHISPER_API_KEY;
  if (!key) throw new Error("Falta WHISPER_API_KEY");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("language", "es");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}
