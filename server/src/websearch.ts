// Web search for branded and restaurant foods, through Tavily's basic search (1 credit per call).
// Off unless TAVILY_API_KEY is set.

export const webSearchEnabled = () => !!process.env.TAVILY_API_KEY;

export async function webSearch(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 3 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 600) }));
}
