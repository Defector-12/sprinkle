import { describe, expect, it } from 'vitest';

import { extractArticle } from '../../src/core/article-extractor.ts';

describe('extractArticle', () => {
  it('extracts article structure, code, and image context while ignoring chrome', () => {
    document.body.innerHTML = `
      <nav>Global navigation</nav>
      <main>
        <article>
          <h1>Building a contextual reader</h1>
          <p>A reader needs the surrounding article to answer precisely.</p>
          <h2>Retrieval</h2>
          <p>Relevant chunks should include the current section.</p>
          <pre><code class="language-ts">const context = retrieve(article)</code></pre>
          <figure>
            <img src="/architecture.png" alt="Reader architecture">
            <figcaption>Content script to model request flow</figcaption>
          </figure>
        </article>
      </main>
      <footer>Newsletter signup</footer>
    `;

    const article = extractArticle(document, 'https://example.com/blog/reader');

    expect(article.title).toBe('Building a contextual reader');
    expect(article.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'code',
    ]);
    expect(article.blocks.map((block) => block.text).join(' ')).not.toContain(
      'Global navigation',
    );
    expect(article.images).toEqual([
      expect.objectContaining({
        src: 'https://example.com/architecture.png',
        alt: 'Reader architecture',
        caption: 'Content script to model request flow',
        section: 'Retrieval',
      }),
    ]);
    expect(article.isPartial).toBe(false);
  });

  it('marks pages with very little readable content as partial', () => {
    document.body.innerHTML = '<main><p>Short note.</p></main>';

    const article = extractArticle(document, 'https://example.com/note');

    expect(article.isPartial).toBe(true);
    expect(article.blocks).toHaveLength(1);
  });

  it('uses document metadata fallbacks and handles lists, quotes, and lazy images', () => {
    document.title = 'Fallback document title';
    document.body.innerHTML = `
      <div role="main">
        <p aria-hidden="true">Hidden utility text</p>
        <ul><li>First retrieval step</li><li>Second retrieval step</li></ul>
        <blockquote>Context changes the meaning of a term.</blockquote>
        <p>${'Readable content '.repeat(8)}</p>
        <img data-src="/lazy.png">
        <img data-src="/lazy.png">
        <img src="http://[invalid">
        <h2>Later section</h2>
      </div>
    `;

    const article = extractArticle(document, 'https://example.com/guide');

    expect(article.title).toBe('Fallback document title');
    expect(article.blocks.map((block) => block.type)).toEqual([
      'list',
      'quote',
      'paragraph',
      'heading',
    ]);
    expect(article.blocks.map((block) => block.text).join(' ')).not.toContain(
      'Hidden utility text',
    );
    expect(article.images).toHaveLength(2);
    expect(article.images[0]?.src).toBe('https://example.com/lazy.png');
    expect(article.images[1]?.src).toBe('http://[invalid');
  });
});
