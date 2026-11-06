import type { ReactNode } from 'react';

/**
 * Small, safe Markdown renderer for assistant replies: fenced code blocks,
 * headings, bullet/numbered lists, horizontal rules, **bold**, and `code`.
 * It builds React elements only (no HTML injection).
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/gu;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    nodes.push(token.startsWith('`')
      ? <code key={`${keyPrefix}-${index}`} className="md-inline-code">{token.slice(1, -1)}</code>
      : <strong key={`${keyPrefix}-${index}`}>{token.slice(2, -2)}</strong>);
    last = start + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { readonly type: 'code'; readonly language: string; readonly text: string }
  | { readonly type: 'heading'; readonly level: number; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: string[] }
  | { readonly type: 'rule' }
  | { readonly type: 'paragraph'; readonly text: string };

export function parseMarkdownBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/u.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ type: 'code', language: fence[1] ?? '', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/u.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/u.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/u.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const previous = blocks.at(-1);
      if (previous?.type === 'list' && previous.ordered === ordered) previous.items.push(item[3] ?? '');
      else blocks.push({ type: 'list', ordered, items: [item[3] ?? ''] });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

export function MessageContent({ text }: { readonly text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="message-markdown">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        switch (block.type) {
          case 'code':
            return (
              <pre key={key} className="md-code" data-language={block.language || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          case 'heading':
            return <p key={key} className={`md-heading md-heading-${block.level}`}>{inline(block.text, key)}</p>;
          case 'list': {
            const items = block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>);
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          case 'rule':
            return <hr key={key} />;
          default:
            return <p key={key} className="message-text">{inline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
