// Minimal client for DeepSeek's OpenAI-compatible chat API.

const BASE = 'https://api.deepseek.com';
// One fast model for every call: planning, photo descriptions, doodles and tips.
export const MODEL = 'deepseek-flash';

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type Msg =
  | { role: 'system' | 'user'; content: Content }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string | null }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

// think=false turns off reasoning: much faster, fine for well-specified output like sketches.
async function complete(model: string, messages: Msg[], json: boolean, think: boolean): Promise<string> {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      ...(think ? { reasoning_effort: 'low' } : { thinking: { type: 'disabled' } }),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${model} ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { completion_tokens: number } };
  console.log(`deepseek ${model} ${Date.now() - started}ms ${data.usage?.completion_tokens ?? '?'} tokens`);
  return data.choices[0].message.content;
}

// One turn of a tool loop. Thinking mode can't force a tool call, so the caller handles a plain-text answer too.
export async function chatTools(
  model: string,
  messages: Msg[],
  tools: ToolDef[],
): Promise<{ content: string | null; tool_calls: ToolCall[]; reasoning_content: string | null }> {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, tools, reasoning_effort: 'low' }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${model} ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: { message: { content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string | null } }[];
    usage?: { completion_tokens: number };
  };
  const m = data.choices[0].message;
  const names = (m.tool_calls ?? []).map((t) => t.function.name).join(',');
  console.log(`deepseek ${model} tools ${Date.now() - started}ms ${data.usage?.completion_tokens ?? '?'} tokens [${names}]`);
  return { content: m.content, tool_calls: m.tool_calls ?? [], reasoning_content: m.reasoning_content ?? null };
}

export const chatText = (model: string, messages: Msg[], think = true) => complete(model, messages, false, think);

// Models occasionally return malformed JSON; one retry fixes almost all of those.
export async function chatJson<T>(model: string, messages: Msg[], think = true): Promise<T> {
  try {
    return JSON.parse(await complete(model, messages, true, think)) as T;
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    console.warn('retrying after malformed JSON:', err.message);
    return JSON.parse(await complete(model, messages, true, think)) as T;
  }
}
