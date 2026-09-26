import { Fragment, type ReactNode } from 'react';

/**
 * Renders the small Markdown subset the assistants produce — **bold**,
 * "- " / "• " bullet lines and "۱." / "1." numbered lines — as React nodes.
 * Everything else is plain text; nothing is injected as HTML.
 */
export function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} className="rich-list">
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\s*[0-9۰-۹]+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered && !bullet);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (line.trim() === '') {
      blocks.push(<div key={`s${blocks.length}`} className="rich-gap" />);
    } else {
      blocks.push(<p key={`p${blocks.length}`} className="rich-p">{inline(line)}</p>);
    }
  }
  flush();
  return <div className="rich-text">{blocks}</div>;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
