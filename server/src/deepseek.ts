// Minimal client for DeepSeek's OpenAI-compatible chat API.

const BASE = 'https://api.deepseek.com';
// One fast model for every call: planning, photo descriptions, doodles and tips.
export const MODEL = 'deepseek-flash';

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: Content;
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
