import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isHeadAdmin } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const request = new Request('http://internal/admin', { headers: await headers() });
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) redirect('/login');
  if (!isHeadAdmin(auth.user)) redirect('/magazyny');
  return children;
}
