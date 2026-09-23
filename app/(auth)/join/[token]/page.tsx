/**
 * Create the account an invite was issued for.
 *
 * The email is shown but not editable: it is fixed at the moment the invite is
 * made, so a forwarded link cannot become an account under a different address.
 *
 * An open invite is the exception and asks for one, because it was issued
 * without knowing who would use it. The link is what identifies the person, so
 * whoever opens it makes the account — which is why the field is a plain input
 * here and a read-only one above.
 *
 * A spent or unknown token says so plainly rather than rendering a form that
 * cannot succeed. An invite is single use, so this is the ordinary result of
 * opening the link twice — including by pressing back after signing up — and it
 * should not read as a fault.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, inviteForToken } from '@/lib/session';
import { signUpAction } from '../../actions';
import { AuthForm, Field } from '../../auth-form';

export const dynamic = 'force-dynamic';

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (await currentUser()) redirect('/');

  const { token } = await params;
  const invite = await inviteForToken(token);

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          This invite has expired
        </h1>
        <p className="measure pt-2 text-sm text-muted-foreground">
          Invites work once. If you have already made your account, sign in;
          otherwise ask for a new link.
        </p>
        <p className="pt-4 text-sm">
          <Link href="/login" className="link-underline hover:text-foreground">
            Sign in
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
          Create your account
        </h1>
      </header>

      <AuthForm action={signUpAction} submitLabel="Create account">
        <input type="hidden" name="token" value={token} />
        {invite.email === null ? (
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            hint="Use whichever address you want to sign in with."
          />
        ) : (
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={invite.email}
            readOnly
            required={false}
            hint="Set by the invitation."
          />
        )}
        <Field
          label="Your name"
          name="name"
          defaultValue={invite.name ?? ''}
          autoComplete="name"
          hint="Shown beside the companies you monitor."
        />
        <Field
          label="Password"
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
