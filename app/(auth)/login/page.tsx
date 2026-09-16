/**
 * Sign in, or carry on as a guest.
 *
 * The guest path is deliberately as visible as the form. Someone opening a
 * shared link has no account and no way to make one — registration is
 * invite-only — so a page offering only a password would read as a wall rather
 * than a choice.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { continueAsGuestAction, signInAction } from '../actions';
import { AuthForm, Field } from '../auth-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  // Already signed in: the form would only offer to become someone else.
  if (await currentUser()) redirect('/');
  const { reset } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <header className="mb-8 space-y-1">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          AM News
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
        {reset && (
          <p className="measure pt-1 text-sm text-primary">
            Password set. Sign in with it.
          </p>
        )}
      </header>

      {/*
        * The guest form is a SIBLING of the sign-in form, not a child.
        *
        * It was passed as `footer`, which renders inside AuthForm's own
        * <form> — and HTML forbids nesting forms, so the browser dropped the
        * inner one and the button submitted the sign-in action with empty
        * fields. It answered "Email and password are both needed" and never
        * created a session.
        */}
      <AuthForm action={signInAction} submitLabel="Sign in">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <p className="text-right text-2xs">
          <Link href="/forgot" className="text-muted-foreground link-underline hover:text-foreground">
            Forgot your password?
          </Link>
        </p>
      </AuthForm>

      <form action={continueAsGuestAction} className="pt-3 text-center">
        <button
          type="submit"
          className="cursor-pointer text-xs text-muted-foreground link-underline hover:text-foreground"
        >
          Continue as a guest
        </button>
      </form>

      <p className="mt-8 text-center text-2xs text-muted-foreground/70">
        Accounts are by invitation.
      </p>
    </main>
  );
}
