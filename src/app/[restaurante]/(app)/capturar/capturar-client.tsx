"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
}
interface Turn {
  role: "user" | "model";
  text: string;
}
interface Confirmacion {
  id: number;
  text: string;
  ok: boolean;
}
type Status = "idle" | "recording" | "processing";

export default function CapturarClient({
  slug,
  shiftName,
}: {
  slug: string;
  shiftName: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [confirmaciones, setConfirmaciones] = useState<Confirmacion[]>([]);
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const convo = useRef<Turn[]>([]);
  const counter = useRef(0);

  const pushConfirm = (t: string, ok: boolean) =>
    setConfirmaciones((c) => [{ id: counter.current++, text: t, ok }, ...c].slice(0, 4));

  async function send(body: BodyInit, isForm: boolean) {
    setStatus("processing");
    setReply("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: isForm ? undefined : { "content-type": "application/json" },
        body,
      });
      const data = await res.json();
      const t: string = data.transcript ?? "";
      const r: string = data.reply ?? data.error ?? "";
      setTranscript(t);
      setReply(r);
      setPending(data.actions ?? []);
      convo.current = [
        ...convo.current,
        ...(t ? [{ role: "user" as const, text: t }] : []),
        ...(r ? [{ role: "model" as const, text: r }] : []),
      ].slice(-12);
    } catch {
      setReply("No pude procesar. Intenta de nuevo.");
    } finally {
      setStatus("idle");
    }
  }

  const history = () => JSON.stringify(convo.current.slice(-8));

  async function sendText() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setTranscript(t);
    await send(JSON.stringify({ text: t, history: convo.current.slice(-8) }), false);
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const form = new FormData();
        form.append("audio", new Blob(chunks.current, { type: "audio/webm" }), "a.webm");
        form.append("history", history());
        void send(form, true);
      };
      mr.start();
      recRef.current = mr;
      setStatus("recording");
      setTranscript("");
      setReply("");
    } catch {
      setReply("No pude acceder al micrófono.");
    }
  }
  function toggleRec() {
    if (status === "recording") recRef.current?.stop();
    else if (status === "idle") void startRec();
  }

  async function confirm() {
    if (pending.length === 0) return;
    setStatus("processing");
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actions: pending }),
      });
      const data = await res.json();
      const results: { ok: boolean; reply: string }[] =
        data.results ?? [{ ok: !!data.ok, reply: data.reply ?? "Listo" }];
      for (const r of results) pushConfirm(r.reply ?? "Listo", !!r.ok);
      convo.current = [...convo.current, { role: "model" as const, text: data.reply ?? "" }].slice(-12);
      setPending([]);
      setReply("");
      setTranscript("");
      if (data.loggedOut) router.push(`/${slug}/turno-cerrado`);
    } finally {
      setStatus("idle");
    }
  }

  const statusText =
    status === "recording"
      ? `Escuchando${shiftName ? ` turno ${shiftName}` : ""}…`
      : status === "processing"
        ? "Procesando…"
        : pending.length > 0
          ? pending.length > 1
            ? `¿Confirmas las ${pending.length} acciones?`
            : "¿Confirmas?"
          : "Mantén el botón y habla";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#14121a] via-[#0a0a0a] to-[#1a0f14] text-white">
      <div className="flex justify-end p-5">
        <button
          onClick={() => router.push(`/${slug}/hoy`)}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
        >
          Terminar
        </button>
      </div>

      <div className="px-6 text-center">
        <p className="text-2xl font-bold">{statusText}</p>
      </div>

      {/* conversación + confirmaciones */}
      <div className="mt-4 flex flex-1 flex-col items-center gap-2 overflow-y-auto px-6">
        {confirmaciones.map((c) => (
          <div
            key={c.id}
            className={`float-in w-full max-w-sm whitespace-pre-line rounded-2xl px-4 py-3 text-left text-base font-medium leading-relaxed ${
              c.ok ? "bg-teal/20 text-teal" : "bg-coral/20 text-coral"
            }`}
          >
            {c.text}
          </div>
        ))}

        {transcript && (
          <p className="mt-2 max-w-sm text-center text-white/50">“{transcript}”</p>
        )}

        {pending.length > 0 ? (
          <div className="float-in mt-1 w-full max-w-sm rounded-3xl bg-white/10 p-4 text-center">
            <p className="whitespace-pre-line text-left text-lg leading-relaxed">{reply}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={confirm}
                className="flex-1 rounded-full bg-white py-3 font-semibold text-ink disabled:opacity-50"
              >
                {pending.length > 1 ? "Confirmar todo" : "Confirmar"}
              </button>
              <button
                onClick={() => { setPending([]); setReply(""); }}
                className="rounded-full border border-white/30 px-5 py-3 font-semibold"
              >
                No
              </button>
            </div>
          </div>
        ) : reply ? (
          <p className="mt-1 max-w-sm whitespace-pre-line text-center text-lg leading-relaxed text-white">
            {reply}
          </p>
        ) : null}
      </div>

      {/* onda + botón */}
      <div className="flex flex-col items-center gap-5 pb-10">
        <div className="flex h-12 items-end gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className="wave-bar w-1.5 rounded-full bg-coral"
              style={{
                height: 40,
                animationDelay: `${i * 0.1}s`,
                animationPlayState: status === "recording" ? "running" : "paused",
                opacity: status === "recording" ? 1 : 0.25,
              }}
            />
          ))}
        </div>

        <button
          onPointerDown={toggleRec}
          disabled={status === "processing"}
          className={`flex h-24 w-24 items-center justify-center rounded-full text-base font-bold transition disabled:opacity-50 ${
            status === "recording" ? "scale-110 bg-coral" : "bg-white text-ink"
          }`}
        >
          {status === "recording" ? "Detener" : "Hablar"}
        </button>

        <button onClick={() => setShowText((v) => !v)} className="text-sm text-white/50 underline">
          escribir en su lugar
        </button>
        {showText && (
          <div className="flex w-full max-w-sm gap-2 px-6">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder="Escribe aquí"
              className="flex-1 rounded-full bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40"
            />
            <button onClick={sendText} className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink">
              Enviar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
