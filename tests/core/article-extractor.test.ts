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
    expect(article.diagnostics).toEqual(
      expect.objectContaining({
        rootKind: 'main',
        readableLength: 11,
        minimumReadableLength: 80,
        candidateBlockCount: 1,
        acceptedBlockCount: 1,
      }),
    );
  });

  it('records structural evidence that can explain incomplete extraction', () => {
    document.body.innerHTML = `
      <article>
        <p>Brief preview.</p>
        <table><tr><td>Important tabular content</td></tr></table>
        <iframe src="/embedded-document"></iframe>
        <p aria-hidden="true">Hidden article body</p>
        <div class="skeleton">Loading more content</div>
      </article>
      <article>
        <p>${'Long article body '.repeat(20)}</p>
      </article>
    `;

    const article = extractArticle(document, 'https://example.com/dynamic');

    expect(article.diagnostics).toEqual(
      expect.objectContaining({
        rootKind: 'article',
        articleCandidateCount: 2,
        excludedBlockCount: 1,
        tableCount: 1,
        iframeCount: 1,
        loadingIndicatorCount: 1,
      }),
    );
  });

  it('extracts X article text rendered through div and span containers', () => {
    document.title = 'Article / X';
    document.body.innerHTML = `
      <main role="main">
        <article data-testid="tweet">
          <div data-testid="User-Name">硅基流动 @fallai2015</div>
          <div data-testid="longformContent">
            <div>
              <span>梁文锋投资者交流会（完整版全文）</span>
            </div>
            <div>
              <span>欢迎各位投资人。我们一开始来做这个公司，初衷是没有想到最后要赚多少钱，更多资本市场上去，要上市，要怎么样的，所以我们是没有这个初衷的。</span>
            </div>
            <div>
              <span>我们投资这个公司是没有这么想过。如果他这么想，他就不会来。所以总体讲，我们是怀着一个对这个世界非常大的善意来做这个事情。</span>
            </div>
          </div>
          <div role="group" aria-label="互动">
            <button>回复 218</button>
            <button>转发 1.5K</button>
          </div>
        </article>
      </main>
    `;

    const article = extractArticle(
      document,
      'https://x.com/fallai2015/status/123',
    );

    expect(article.isPartial).toBe(false);
    expect(article.blocks.map((block) => block.text)).toEqual([
      '梁文锋投资者交流会（完整版全文）',
      '欢迎各位投资人。我们一开始来做这个公司，初衷是没有想到最后要赚多少钱，更多资本市场上去，要上市，要怎么样的，所以我们是没有这个初衷的。',
      '我们投资这个公司是没有这么想过。如果他这么想，他就不会来。所以总体讲，我们是怀着一个对这个世界非常大的善意来做这个事情。',
    ]);
    expect(article.blocks.map((block) => block.text).join(' ')).not.toContain(
      '回复 218',
    );
    expect(article.diagnostics).toEqual(
      expect.objectContaining({
        fallbackUsed: true,
        fallbackBlockCount: 3,
      }),
    );
  });

  it('falls back to leaf text containers without duplicating React wrapper text', () => {
    document.body.innerHTML = `
      <article>
        <div class="article-shell">
          <div class="title">A custom rendered technical article</div>
          <div class="body">
            <div><span>${'First custom paragraph '.repeat(5)}</span></div>
            <div><span>${'Second custom paragraph '.repeat(5)}</span></div>
          </div>
        </div>
        <div role="toolbar"><button>Share</button></div>
      </article>
    `;

    const article = extractArticle(document, 'https://example.com/custom');

    expect(article.isPartial).toBe(false);
    expect(article.blocks).toHaveLength(3);
    expect(article.blocks.map((block) => block.text).join(' ')).not.toContain(
      'Share',
    );
    expect(new Set(article.blocks.map((block) => block.text)).size).toBe(3);
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
