// Fallback for foods the doodle library doesn't have: the model draws the
// doodle itself, following the library's style, using a library scene as the example.
import { chatJson, MODEL } from '../deepseek.ts';
import { compose, H, W } from './compose.ts';

const EXAMPLE = compose({
  groups: [
    { container: 'plate', foods: [{ id: 'apple' }] },
    { container: 'bowl', foods: [{ id: 'curd' }] },
  ],
}).svg.replace('<g filter="url(#wobble)">', '<g id="art">');

const DRAWER = `You are an illustrator who draws food as minimal, colourful hand-drawn doodles in SVG.
Canvas: viewBox 0 0 ${W} ${H}, origin top-left. Do not include the <svg> tag itself.

Style guide (follow exactly):
- Flat colour fills with dark ink outlines: stroke="#2b2b2b" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round".
- Warm, appetising food colours; no gradients, no shadows except a soft flat plate shadow, no background, no text.
- Seen from slightly above (3/4 view). Plates: off-white ellipse (#fbfaf6) with a light blue inner rim line. Bowls: light blue katori (#7fb2d9) with an off-white rim ellipse, contents shown as a coloured surface inside the rim.
- Draw ONLY the key ingredients, large, centred and recognisable. A few simple details (spots, seeds, slices) make food readable; no clutter.
- Put every element inside one <g id="art">...</g>.

Example for "an apple and a bowl of curd":
${EXAMPLE}

Output JSON: {"svg": "<g id=\\"art\\">...</g>"}`;

// The markup is rendered in the page, so keep only drawing elements.
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\/?svg[^>]*>/gi, '')
    .replace(/<(script|foreignObject|style|image|a|use|iframe)[\s\S]*?(<\/\1>|\/>)/gi, '')
    .replace(/\s(on\w+|href|xlink:href)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/url\((?!#)[^)]*\)/gi, 'none');
}

export async function drawDoodle(description: string): Promise<string> {
  const out = await chatJson<{ svg?: string }>(MODEL, [
    { role: 'system', content: DRAWER },
    { role: 'user', content: `Draw: ${description}` },
  ]);
  const svg = sanitizeSvg(String(out.svg ?? ''));
  if (!svg.trim()) throw new Error('empty drawing');
  return svg.includes('id="art"') ? svg.replace('<g id="art"', '<g filter="url(#wobble)" id="art"') : `<g filter="url(#wobble)">${svg}</g>`;
}
