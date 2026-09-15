/**
 * Ask for a reset link.
 *
 * The response is the same whether or not an account exists. Saying "no such
 * account" would turn this form into a way to find out who is on the team, and
 * the cost of the ambiguity — someone mistyping their address and waiting for
 * mail that never comes — is smaller than that.
 */
import Link from 'next/link';
import { forgotAction } from '../actions';
import { AuthForm, Field } from '../auth-form';

export const dynamic = 'force-dynamic';

export default function ForgotPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <header className="mb-8 space-y-1">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          AM News
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="measure pt-1 text-sm text-muted-foreground">
          We will send a link that works for one hour.
        </p>
      </header>

      <AuthForm
        action={forgotAction}
        submitLabel="Send the link"
        footer={
          <p className="pt-2 text-center text-xs">
            <Link href="/login" className="text-muted-foreground link-underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        }
      >
        <Field label="Email" name="email" type="email" autoComplete="email" />
      </AuthForm>
    </main>
  );
}
