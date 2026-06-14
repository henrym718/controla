/** Cliente del agente sobre la API REST de Gemini (function calling). */

export interface AgentTurn {
  role: "user" | "model";
  text: string;
}

export interface AgentDecision {
  /** Puede traer VARIAS llamadas si la usuaria dictó varias acciones en un mensaje. */
  functionCalls?: { name: string; args: Record<string, unknown> }[];
  text?: string;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

function modelCandidates(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  // el configurado primero, luego respaldos (sin duplicar)
  return [...new Set([configured].filter(Boolean))] as string[];
}

export async function runAgent(opts: {
  systemInstruction: string;
  history: AgentTurn[];
  functionDeclarations: unknown[];
}): Promise<AgentDecision> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY");

  const body = {
    system_instruction: { parts: [{ text: opts.systemInstruction }] },
    contents: opts.history.map((t) => ({
      role: t.role,
      parts: [{ text: t.text }],
    })),
    tools: [{ function_declarations: opts.functionDeclarations }],
    tool_config: { function_calling_config: { mode: "AUTO" } },
  };

  let lastError = "";
  for (const model of modelCandidates()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      lastError = `Gemini ${res.status} (${model})`;
      // 404 = modelo inexistente → probar el siguiente
      if (res.status === 404 || res.status === 400) continue;
      throw new Error(`${lastError}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts
      .filter((p) => p.functionCall)
      .map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    if (calls.length) return { functionCalls: calls };

    const text = parts.map((p) => p.text).filter(Boolean).join("\n").trim();
    return { text: text || "No entendí, ¿me lo repites?" };
  }

  throw new Error(`No se pudo contactar a Gemini. ${lastError}`);
}
