"use client";

import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { actions, useDisposition, useStore } from "@/lib/dashboard-store";
import type { Familiarity, DismissReason } from "@/lib/ui-types";
import type { DashboardCompany as Company } from "@/lib/ui-types";
import {
  QuietButton,
  familiarityHelp,
  familiarityLabel,
  dismissReasonFeedback,
  dismissReasonLabel,
} from "./primitives";

const FAMILIARITY_ORDER: Familiarity[] = [
  "no_status",
  "known",
  "in_conversation",
  "not_known",
];

const DISMISS_REASONS: DismissReason[] = ["irrelevant_company", "too_early", "no_sg_angle"];

export function FamiliarityControl({ company }: { company: Company }) {
  const stored = useStore((s) => s.familiarity[company.id]);
  const value = stored ?? company.familiarity;

  // A select rather than four buttons: the labels do not fit one line in a
  // ~300px card, and wrapping them cost two rows for a field that is set once
  // and rarely changed. The help text moves to the option titles.
  return (
    <label className="flex items-center gap-x-2">
      {/* Status, not Account: the field is familiarity — no status, known, in
          conversation, not known — and none of those says an account exists. */}
      <span className="shrink-0 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
        Status
      </span>
      <select
        value={value}
        onChange={(e) => actions.setFamiliarity(company.id, e.target.value as Familiarity)}
        title={familiarityHelp[value]}
        className={cn(
          "min-w-0 flex-1 cursor-pointer rounded-sm border border-border/60 bg-transparent px-1.5 py-0.5 text-2xs transition-colors hover:border-primary/50",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring",
          value === "no_status"
            ? "text-muted-foreground hover:border-border hover:text-foreground"
            : "border-primary/30 bg-primary/10 font-medium text-primary",
        )}
      >
        {FAMILIARITY_ORDER.map((s) => (
          <option key={s} value={s} title={familiarityHelp[s]}>
            {familiarityLabel[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

function DraftEmailPanel({ company, onClose }: { company: Company; onClose: () => void }) {
  const [owner, setOwner] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [body, setBody] = useState(
    // Addressed to a role rather than a named person (§9): the graph holds
    // names, but outreach from a government agency should not open by naming
    // someone the tool inferred.
    `Dear ${company.name} team,\n\n` +
      `Congratulations on the news this week — ${company.trigger.headline.toLowerCase()}.\n\n` +
      `I lead the ${company.sector === "biotech" ? "biotech" : "technology"} team at the Economic Development Board. ` +
      `As you look at where the next phase of ${company.name}'s work sits, it may be worth a short conversation about ` +
      `${company.offer?.title.toLowerCase() ?? "what Singapore could support"}.\n\n` +
      `Would half an hour in the next fortnight be useful?\n\nBest regards,`,
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Nothing is ever sent automatically. This draft is yours to edit and copy.
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={9}
        className="w-full max-w-[70ch] resize-y rounded-sm bg-muted/50 p-3 font-sans text-sm leading-relaxed outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap gap-3">
        {[
          { label: "Owner", value: owner, set: setOwner, ph: "optional" },
          { label: "Next action", value: nextAction, set: setNextAction, ph: "optional" },
        ].map((f) => (
          <label key={f.label} className="flex flex-col gap-1 text-2xs text-muted-foreground">
            {f.label}
            <input
              value={f.value}
              placeholder={f.ph}
              onChange={(e) => f.set(e.target.value)}
              className="w-44 rounded-sm bg-muted/50 px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-44 rounded-sm bg-muted/50 px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
          />
        </label>
      </div>
      <p className="text-2xs text-muted-foreground">
        Owner, next action and due date are all optional — skip them and the draft still saves.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            actions.setDisposition(company.id, {
              disposition: "draft_email",
              owner: owner || undefined,
              nextAction: nextAction || undefined,
              dueDate: dueDate || undefined,
            });
            onClose();
          }}
          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(body)}
          className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DismissPanel({ company, onClose }: { company: Company; onClose: () => void }) {
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
      <div className="flex flex-wrap gap-1">
        {DISMISS_REASONS.map((r) => (
          <QuietButton key={r} active={reason === r} onClick={() => setReason(r)}>
            {dismissReasonLabel[r]}
          </QuietButton>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note"
        className="w-full max-w-[50ch] rounded-sm bg-muted/50 px-2 py-1 text-sm outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!reason}
          onClick={() => {
            if (!reason) return;
            actions.setDisposition(company.id, {
              disposition: "dismiss",
              reason,
              note: note || undefined,
            });
            onClose();
          }}
          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-30"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DispositionControls({
  company,
  preselect,
  compact,
}: {
  company: Company;
  preselect?: "draft_email" | "monitor" | "dismiss" | undefined;
  compact?: boolean | undefined;
}) {
  const record = useDisposition(company.id);
  const [open, setOpen] = useState<null | "draft" | "dismiss">(
    preselect === "draft_email" ? "draft" : preselect === "dismiss" ? "dismiss" : null,
  );

  // Escape closes the draft overlay, as any overlay should.
  useEffect(() => {
    if (open !== "draft") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const line = record
    ? record.disposition === "draft_email"
      ? "Draft saved. It is yours to copy and send — nothing left this tool."
      : record.disposition === "monitor"
        ? "Monitoring. Later activity appears in the monitoring section instead of competing for a discovery slot."
        : `Dismissed — ${dismissReasonLabel[record.reason!]}. ${dismissReasonFeedback[record.reason!]}.`
    : "";

  return (
    <div className={cn("w-full", compact ? "mt-1.5" : "mt-3")}>
      {/* Both states occupy the SAME grid cell, so the container is always as
          tall as the taller one and nothing resizes when they swap. Only
          opacity changes. */}
      <div className="grid">
        {/* Buttons */}
        <div
          className={cn(
            "col-start-1 row-start-1 transition-opacity duration-300 ease-out",
            record ? "pointer-events-none opacity-0" : "opacity-100",
          )}
          aria-hidden={record ? true : undefined}
        >
          {company.duplicateOutreach && (
            <p className="mb-2 text-xs text-caution">
              Open opportunity already exists — owned by {company.duplicateOutreach.owner} since{" "}
              <span className="num">{company.duplicateOutreach.since}</span>.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <button
              type="button"
              onClick={() => setOpen(open === "draft" ? null : "draft")}
              className={cn(
                "rounded-sm px-2 py-1 text-xs transition-colors duration-200 ease-out",
                open === "draft" || preselect === "draft_email"
                  ? "bg-primary text-primary-foreground"
                  // Quiet at rest, filled on hover. Twenty-five filled buttons
                  // down a page is twenty-five things asking to be clicked.
                  : "font-medium text-primary hover:bg-primary hover:text-primary-foreground",
              )}
            >
              Draft an email
            </button>
            <span className="text-muted-foreground/40">·</span>
            <QuietButton
              onClick={() => actions.setDisposition(company.id, { disposition: "monitor" })}
              title="Watch for what this company does next."
            >
              Monitor
            </QuietButton>
            <span className="text-muted-foreground/40">·</span>
            <QuietButton onClick={() => setOpen(open === "dismiss" ? null : "dismiss")}>
              Dismiss
            </QuietButton>
          </div>
        </div>

        {/* Confirmation */}
        <div
          className={cn(
            "col-start-1 row-start-1 border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground transition-all duration-300 ease-out",
            record
              ? "translate-x-0 opacity-100 delay-150"
              : "pointer-events-none -translate-x-4 opacity-0",
          )}
          aria-hidden={record ? undefined : true}
        >
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-foreground/80">
              {record?.disposition === "draft_email"
                ? "Email drafted"
                : record?.disposition === "monitor"
                  ? "Monitored"
                  : "Dismissed"}
              <span className="num"> · {record?.at}</span>
            </span>
            <button
              type="button"
              onClick={() => actions.clearDisposition(company.id)}
              className="link-underline hover:text-foreground"
            >
              Undo
            </button>
          </div>
          <p className="mt-1 leading-relaxed">{line}</p>
        </div>
      </div>

      {/* An overlay, not a panel that grows the card: a draft is a few hundred
          words and a form, which pushes every card below it down the column and
          re-packs the masonry while someone is trying to write. */}
      {!record && open === "draft" && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-[2px] duration-200 animate-in fade-in sm:p-8"
          onClick={() => setOpen(null)}
          role="presentation"
        >
          <div
            className="panel-scale my-auto w-full max-w-2xl overflow-hidden rounded-md border border-border bg-card p-5 shadow-lg duration-200 animate-in fade-in zoom-in-[0.98]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Draft an email to ${company.name}`}
          >
            <div className="flex items-baseline justify-between gap-x-4 pb-1">
              <span className="font-display text-base font-semibold tracking-tight">
                Draft an email · {company.name}
              </span>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="text-2xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <DraftEmailPanel company={company} onClose={() => setOpen(null)} />
          </div>
        </div>
      )}
      {!record && open === "dismiss" && (
        <div className="duration-300 ease-out animate-in fade-in">
          <DismissPanel company={company} onClose={() => setOpen(null)} />
        </div>
      )}
    </div>
  );
}
