import type {
  ArticleBlock,
  ArticleBlockType,
  ArticleDocument,
  ArticleImage,
} from './types.ts';

const CONTENT_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre',
  'blockquote',
  'ul',
  'ol',
].join(',');

const EXCLUDED_ANCESTORS = [
  'nav',
  'footer',
  'aside',
  'form',
  '[role="navigation"]',
  '[aria-hidden="true"]',
].join(',');

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function blockTypeFor(element: Element): ArticleBlockType {
  const tagName = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (tagName === 'pre') return 'code';
  if (tagName === 'blockquote') return 'quote';
  if (tagName === 'ul' || tagName === 'ol') return 'list';
  return 'paragraph';
}

function findArticleRoot(source: Document): Element {
  return (
    source.querySelector('article') ??
    source.querySelector('main') ??
    source.querySelector('[role="main"]') ??
    source.body
  );
}

function findSection(root: Element, target: Element, fallback: string): string {
  let section = fallback;
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');

  for (const heading of headings) {
    const relationship = heading.compareDocumentPosition(target);
    if (relationship & Node.DOCUMENT_POSITION_FOLLOWING) {
      section = cleanText(heading.textContent) || section;
      continue;
    }
    break;
  }

  return section;
}

function nearbyText(image: Element): string {
  const figure = image.closest('figure');
  const parts = [
    figure?.previousElementSibling?.textContent,
    figure?.querySelector('figcaption')?.textContent,
    figure?.nextElementSibling?.textContent,
    image.previousElementSibling?.textContent,
    image.nextElementSibling?.textContent,
  ]
    .map(cleanText)
    .filter(Boolean);

  return [...new Set(parts)].join(' ').slice(0, 800);
}

function resolveImageUrl(source: string, pageUrl: string): string {
  try {
    return new URL(source, pageUrl).toString();
  } catch {
    return source;
  }
}

export function extractArticle(
  source: Document,
  pageUrl: string,
): ArticleDocument {
  const root = findArticleRoot(source);
  const firstHeading = root.querySelector('h1');
  const title =
    cleanText(firstHeading?.textContent) ||
    cleanText(source.title) ||
    new URL(pageUrl).hostname;

  let currentSection = title;
  const blocks: ArticleBlock[] = [];

  for (const element of root.querySelectorAll(CONTENT_SELECTOR)) {
    if (element.closest(EXCLUDED_ANCESTORS)) continue;

    const text = cleanText(element.textContent);
    if (!text) continue;

    const type = blockTypeFor(element);
    if (type === 'heading') currentSection = text;

    blocks.push({
      id: `block-${blocks.length + 1}`,
      type,
      text,
      section: currentSection,
      order: blocks.length,
    });
  }

  const seenImages = new Set<string>();
  const images: ArticleImage[] = [];

  for (const image of root.querySelectorAll('img')) {
    const rawSource =
      (image as HTMLImageElement).currentSrc ||
      image.getAttribute('src') ||
      image.getAttribute('data-src') ||
      '';
    if (!rawSource) continue;

    const src = resolveImageUrl(rawSource, pageUrl);
    if (seenImages.has(src)) continue;
    seenImages.add(src);

    const figure = image.closest('figure');
    images.push({
      id: `image-${images.length + 1}`,
      src,
      alt: cleanText(image.getAttribute('alt')),
      caption: cleanText(figure?.querySelector('figcaption')?.textContent),
      section: findSection(root, image, title),
      surroundingText: nearbyText(image),
    });
  }

  const readableLength = blocks.reduce(
    (total, block) => total + block.text.length,
    0,
  );

  return {
    title,
    url: pageUrl,
    blocks,
    images,
    isPartial: readableLength < 80,
  };
}
