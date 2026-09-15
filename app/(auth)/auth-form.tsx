'use client';

import { useActionState } from 'react';
import type { FormState } from './actions';

/**
 * The shared shell for signing in and signing up.
 *
 * One component because the two forms differ only in their fields and their
 * button: the framing, the error line and the pending state are the same
 * problem, and two copies would drift.
 *
 * The error sits above the button rather than beside the field it came from —
 * "email or password is not right" deliberately does not say which, so pinning
 * it to one field would imply an answer the message refuses to give.
 */
export function AuthForm({
  action,
  submitLabel,
  children,
  footer,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4">
      {children}
      {/* A form here either fails or reports something that is not a
          navigation, so both branches render in the same place — the reader
          looks for the answer where the last one appeared. */}
      {state && 'error' in state && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state && 'ok' in state && (
        <p role="status" className="text-xs text-primary">
          {state.ok}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full cursor-pointer rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Just a moment…' : submitLabel}
      </button>
      {footer}
    </form>
  );
}

/** One labelled input. Kept here so both forms space their fields alike. */
export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  readOnly,
  autoComplete,
  required = true,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  readOnly?: boolean;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-2xs uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        readOnly={readOnly}
        required={required}
        autoComplete={autoComplete}
        className="w-full rounded-sm border border-border bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary/50 read-only:text-muted-foreground"
      />
      {hint && <span className="block text-2xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
