import { Image as ImageIcon, Quote } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { MessageReference } from '../core/types.ts';

export function AssistantMarkdown({
  content,
  busy = false,
  caretClassName,
}: {
  content: string;
  busy?: boolean;
  caretClassName?: string;
}) {
  return (
    <div className="message-markdown" aria-busy={busy || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="message-markdown__table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {busy && caretClassName && (
        <span className={caretClassName} aria-hidden="true" />
      )}
    </div>
  );
}

export function MessageReferenceCard({
  reference,
}: {
  reference?: MessageReference;
}) {
  if (!reference) return null;

  const isText = reference.type === 'text';
  const label = isText
    ? '引用文字'
    : reference.type === 'region'
      ? '框选区域'
      : '引用图片';
  const description = isText
    ? reference.text
    : reference.type === 'image'
      ? reference.alt || reference.text || label
      : reference.text || label;

  return (
    <aside className="message-reference" role="note" aria-label="提问引用">
      <div className="message-reference__media" aria-hidden="true">
        {!isText && reference.imageUrl ? (
          <img src={reference.imageUrl} alt="" />
        ) : isText ? (
          <Quote size={15} />
        ) : (
          <ImageIcon size={16} />
        )}
      </div>
      <div className="message-reference__copy">
        <span>{label}</span>
        <strong>{reference.section}</strong>
        <p title={description}>{description}</p>
      </div>
    </aside>
  );
}
