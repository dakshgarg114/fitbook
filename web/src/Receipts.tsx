// The agent appends one line per change it made ("Logged …", "Removed …").
// Those become action receipts under its reply instead of plain text.
// Matched strictly, so a reply that happens to start with "Logged…" stays part of the reply.
const RECEIPT =
  /^(Logged .+ at \d{1,2}:\d{2}, \d+ kcal\.|Removed .+\.|Updated your .+|Updated .+ to \d+ g \(\d+ kcal\)\.|Added .+ \(\d+ kcal\) to .+\.|Your daily targets:.*|Remembered: .+\.|Forgot: .+\.)$/;
export function splitReply(text: string): { reply: string; actions: string[] } {
  const lines = text.split('\n');
  const actions = lines.filter((l) => RECEIPT.test(l.trim()));
  return {
    reply: lines
      .filter((l) => !RECEIPT.test(l.trim()))
      .join('\n')
      .trim(),
    actions,
  };
}

export function Receipt({ text }: { text: string }) {
  const kind = /^(Removed|Forgot)/.test(text) ? 'remove' : /^(Updated|Your daily|Remembered)/.test(text) ? 'edit' : 'add';
  const icon = kind === 'remove' ? 'M6 12h12' : kind === 'edit' ? 'M4 20h4L19 9l-4-4L4 16v4z' : 'M5 12.5l4.5 4.5L19 7';
  return (
    <div class={`receipt ${kind}`}>
      <span class="receipt-icon">
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={icon} />
        </svg>
      </span>
      {text.replace(/\.$/, '')}
    </div>
  );
}
