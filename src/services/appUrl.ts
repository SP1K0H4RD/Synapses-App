const getConfiguredAppUrl = (): string | null => {
  const appUrlRaw = (globalThis as any).__APP_URL__ as string | undefined;
  const appUrl = typeof appUrlRaw === 'string' ? appUrlRaw.trim() : '';
  if (!appUrl) return null;

  try {
    return new URL(appUrl).toString();
  } catch {
    return null;
  }
};

export const getAppBaseUrl = (): string => {
  return getConfiguredAppUrl() ?? window.location.origin;
};

export const getApiCandidateUrls = (path: string): URL[] => {
  const configuredAppUrl = getConfiguredAppUrl();
  const origin = window.location.origin;
  const pathname = window.location.pathname;
  const lastSegment = pathname.split('/').filter(Boolean).pop() ?? '';
  const basePath =
    pathname.endsWith('/') ? pathname : lastSegment.includes('.') ? pathname.replace(/[^/]+$/, '') : `${pathname}/`;

  const urls = [
    ...(configuredAppUrl ? [new URL(path, configuredAppUrl)] : []),
    new URL(path.replace(/^\//, ''), `${origin}${basePath}`),
    new URL(path, origin),
  ];

  const seen = new Set<string>();
  return urls.filter((url) => {
    const key = url.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
