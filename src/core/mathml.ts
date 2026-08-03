const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

const ALLOWED_TAGS = new Set([
  'math',
  'semantics',
  'annotation',
  'annotation-xml',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
  'ms',
  'mglyph',
  'mfrac',
  'msqrt',
  'mroot',
  'mstyle',
  'merror',
  'mpadded',
  'mphantom',
  'mfenced',
  'menclose',
  'msub',
  'msup',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mmultiscripts',
  'mprescripts',
  'none',
  'mtable',
  'mtr',
  'mtd',
  'mlabeledtr',
  'mstack',
  'mlongdiv',
  'msgroup',
  'msrow',
  'mscarries',
  'mscarry',
  'msline',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'display',
  'encoding',
  'mathvariant',
  'mathsize',
  'stretchy',
  'symmetric',
  'fence',
  'separator',
  'form',
  'lspace',
  'rspace',
  'accent',
  'accentunder',
  'align',
  'columnalign',
  'rowalign',
  'columnspan',
  'rowspan',
  'width',
  'height',
  'depth',
  'notation',
  'linethickness',
  'bevelled',
  'scriptlevel',
  'displaystyle',
]);

function sanitizeElement(
  source: Element,
  output: XMLDocument,
): Element | null {
  const tagName = source.localName.toLowerCase();
  if (!ALLOWED_TAGS.has(tagName)) return null;

  const target = output.createElementNS(MATHML_NAMESPACE, tagName);
  for (const attribute of source.attributes) {
    const name = attribute.localName.toLowerCase();
    if (ALLOWED_ATTRIBUTES.has(name)) {
      target.setAttribute(name, attribute.value.slice(0, 500));
    }
  }
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.append(output.createTextNode(child.textContent ?? ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const safeChild = sanitizeElement(child as Element, output);
      if (safeChild) target.append(safeChild);
    }
  }
  return target;
}

export function sanitizeMathMl(markup: string): string {
  if (!markup.trim()) return '';
  const parsed = new DOMParser().parseFromString(markup, 'application/xml');
  if (
    parsed.querySelector('parsererror') ||
    parsed.documentElement.localName.toLowerCase() !== 'math'
  ) {
    return '';
  }

  const output = document.implementation.createDocument(
    MATHML_NAMESPACE,
    '',
    null,
  );
  const safeMath = sanitizeElement(parsed.documentElement, output);
  return safeMath ? new XMLSerializer().serializeToString(safeMath) : '';
}
