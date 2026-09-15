/**
 * Choose a new password from a reset link.
 *
 * An expired or spent link says so rather than showing a form that cannot
 * succeed. Links last an hour and work once, so this is the ordinary result of
 * opening one twice or coming back to it later — not a fault.
 */
import Link from 'next/link';
import { resetForToken } from '@/lib/session';
import { resetAction } from '../../actions';
import { AuthForm, Field } from '../../auth-form';

export const dynamic = 'force-dynamic';

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const reset = await resetForToken(token);

  if (!reset) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          This link has expired
        </h1>
        <p className="measure pt-2 text-sm text-muted-foreground">
          Reset links last an hour and work once. Ask for another and it will
          arrive in a moment.
        </p>
        <p className="pt-4 text-sm">
          <Link href="/forgot" className="link-underline hover:text-foreground">
            Send a new link
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <header className="mb-8 space-y-1">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          AM News
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          New password
        </h1>
        <p className="measure pt-1 text-sm text-muted-foreground">
          For {reset.name}. Setting it signs out every browser signed in as you.
        </p>
      </header>

      <AuthForm action={resetAction} submitLabel="Set password">
        <input type="hidden" name="token" value={token} />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
        />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" />
      </AuthForm>
    </main>
  );
}
