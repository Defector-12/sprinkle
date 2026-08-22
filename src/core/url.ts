const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref_src',
]);

function isTrackingParameter(name: string): boolean {
  return name.startsWith('utm_') || TRACKING_PARAMETERS.has(name);
}

export function normalizePageUrl(value: string): string {
  const url = new URL(value);
  if (!/^#!?\//.test(url.hash)) url.hash = '';

  const meaningfulParameters = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParameter(name.toLowerCase()))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = leftName.localeCompare(rightName);
      return nameOrder || leftValue.localeCompare(rightValue);
    });

  url.search = '';
  for (const [name, parameterValue] of meaningfulParameters) {
    url.searchParams.append(name, parameterValue);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function createPageKey(tabId: number, url: string): string {
  return `${tabId}:${normalizePageUrl(url)}`;
}
