'use client';

import { useActionState } from 'react';
import { changeNameAction, changePasswordAction, type FormState } from './actions';

/**
 * The two account forms.
 *
 * Both report in place rather than redirecting: changing a password and landing
 * back on the dashboard leaves the reader wondering whether it worked, and the
 * confirmation is the only evidence they get.
 */
export function AccountForms({ name }: { name: string }) {
  return (
    <div className="space-y-12">
      <NameForm name={name} />
      <PasswordForm />
    </div>
  );
}

function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(changeNameAction, null as FormState);
  return (
    <form action={action} className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Name</h2>
        <p className="text-2xs text-muted-foreground">
          Shown beside the companies you monitor, so your team can see who is watching what.
        </p>
      </div>
      <Input label="Name" name="name" defaultValue={name} autoComplete="name" />
      <Result state={state} />
      <Submit pending={pending} label="Save name" />
    </form>
  );
}

function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null as FormState);
  return (
    <form action={action} className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Password</h2>
        <p className="text-2xs text-muted-foreground">
          Changing it signs out every other browser signed in as you.
        </p>
      </div>
      <Input label="Current password" name="current" type="password" autoComplete="current-password" />
      <Input
        label="New password"
        name="next"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
      />
      <Input label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
      <Result state={state} />
      <Submit pending={pending} label="Change password" />
    </form>
  );
}

function Input({
  label, name, type = 'text', defaultValue, autoComplete, hint,
}: {
  label: string; name: string; type?: string;
  defaultValue?: string; autoComplete?: string; hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-2xs uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required
        autoComplete={autoComplete}
        className="w-full rounded-sm border border-border bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary/50"
      />
      {hint && <span className="block text-2xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Result({ state }: { state: FormState }) {
  if (!state) return null;
  const bad = 'error' in state;
  return (
    <p role="alert" className={bad ? 'text-xs text-destructive' : 'text-xs text-primary'}>
      {bad ? state.error : state.ok}
    </p>
  );
}

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="cursor-pointer rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}
