/**
 * Your own account: the name others see, and the password.
 *
 * A guest has nothing to manage here, so this redirects rather than rendering
 * an empty shell — the thing they want is the sign-in form.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { signOutAction } from '../(auth)/actions';
import { AccountForms } from './forms';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const me = await currentUser();
  if (!me) redirect('/login');

  return (
    <main className="mx-auto max-w-[36rem] px-6 py-10 sm:px-12 sm:py-14">
      <header className="mb-10 space-y-1">
        <p className="text-sm">
          <Link href="/" className="text-muted-foreground link-underline hover:text-foreground">
            back to the week
          </Link>
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Your account</h1>
        <p className="measure pt-1 text-sm text-muted-foreground">
          Signed in as {me.email}
          {me.role === 'admin' && ' · admin'}
        </p>
      </header>

      <AccountForms name={me.name} />

      <form action={signOutAction} className="mt-12 border-t border-border pt-6">
        <button
          type="submit"
          className="cursor-pointer text-xs text-muted-foreground link-underline hover:text-foreground"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
