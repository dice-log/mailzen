import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
  const category = url.searchParams.get('category') ?? 'all';
  const apiBase = import.meta.env.VITE_API_BASE ?? '';

  const res = await fetch(`${apiBase}/api/mails?category=${category}&limit=50`);
  const mails = res.ok ? await res.json() : [];

  return { mails, category };
};
