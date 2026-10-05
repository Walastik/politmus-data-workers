const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${suffix}`
}

// Intercept outgoing fetch requests to inject the Clerk JWT token
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const [resource, config] = args;
  
  // Determine the URL being fetched
  const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : String(resource));
  
  // Only intercept requests to our own API (e.g. starting with API_BASE or /api/)
  const isApiRequest = url.startsWith(API_BASE) && API_BASE !== '' || url.startsWith('/api/') || url.includes('/api/officials') || url.includes('/api/bills');
  
  if (!isApiRequest) {
    return originalFetch(...args);
  }

  // Create a new config object so we don't mutate the original
  const newConfig = { ...config };
  
  // If resource is a Request, we should extract its headers if config doesn't have them
  const existingHeaders = config?.headers || (resource instanceof Request ? resource.headers : undefined);
  newConfig.headers = new Headers(existingHeaders);
  
  try {
    // @ts-ignore - ClerkProvider mounts the Clerk instance on window
    if (window.Clerk && window.Clerk.session) {
      // @ts-ignore
      const token = await window.Clerk.session.getToken();
      if (token) {
        newConfig.headers.set('Authorization', `Bearer ${token}`);
      }
    }
  } catch (err) {
    console.error('Error fetching Clerk token', err);
  }
  
  return originalFetch(resource, newConfig);
};
