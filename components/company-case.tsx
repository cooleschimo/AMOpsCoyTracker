"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { LocationEdit } from "./location-edit";
import { cn, profileLabel } from "@/lib/utils";
import type { DashboardCompany as Company } from "@/lib/ui-types";
import {
  BandMeterSet,
  CheckFirst,
  FactGrid,
  Label,
  NewTodayTag,
  SectorTag,
  SignalBadge,
  SignalTypeSet,
  SourceLink,
  WhyNow,
  bandLabel,
  offerTierLabel,
} from "./primitives";
import { FamiliarityControl, DispositionControls } from "./company-controls";

export function CompanyHeading({ company, note }: { company: Company; note?: string | undefined }) {
  const newToday = company.whyNow.filter((p) => p.isNew).length;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="inline-flex items-start gap-1.5">
        <Link href={`/company/${company.id}`}
          className="font-serif text-2xl tracking-tight hover:link-underline"
        >
          {company.name}
        </Link>
        {/* A company holds its place all week, so the name alone cannot say
            whether anything moved. The bubble sits against the name because
            that is where a reader scanning a grid is already looking. */}
        {newToday > 0 ? <NewTodayTag count={newToday} items={company.whyNow} /> : null}
      </span>
      {/* The sector is already tagged above the name; repeating it here spends
          a line on something the reader has just read. */}
      <LocationEdit companyId={Number(company.companyId)} hq={company.hq} source={company.hqSource} />
      {note && (
        <span className="font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * What the company does, under its name.
 *
 * A reader scanning the week meets most of these companies for the first time,
 * and until now the card answered what JUST HAPPENED without ever saying what
 * the company IS — leaving them to infer it from a headline and a sector tag.
 *
 * Absent for a company whose evidence was about the wrong entity, which is
 * common enough to design for: the line is generated from scraped search text,
 * and scripts/write-one-liners.ts returns nothing rather than guess. So this
 * renders only when there is something to say.
 */
function OneLiner({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <p className="measure mt-1 text-xs italic leading-snug text-muted-foreground">{text}</p>
  );
}

export function CompanyCase({
  company,
  note,
  preselect,
  defaultOpen = false,
}: {
  company: Company;
  note?: string | undefined;
  preselect?: "draft_email" | "monitor" | "dismiss" | undefined;
  defaultOpen?: boolean;
}) {
  const a = company.assessment;
  // Collapsed by default. The header and the bands are what a reader scans; the
  // evidence and the actions are what they open when a company earns it, and
  // holding every card open makes the list unscannable.
  const [open, setOpen] = useState(defaultOpen || Boolean(preselect));

  // Escape closes, as any overlay should.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <article className="company-card overflow-hidden rounded-md border border-border bg-card transition-colors">
      {/* Header zone. The badge sits top-right in flow rather than absolutely
          positioned — in the two-column layout a card is narrow enough that a
          pinned corner overlaps the company name. */}
      <div className="space-y-3 p-5 sm:p-7">
        {/* One right-aligned group, not two. MetaRow is itself justify-between,
            so nesting it beside the badges pushed the date into them at narrow
            widths — the meta now flows left and the badges own the right edge. */}
        <div className="flex items-start justify-between gap-x-3">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
            <SectorTag sector={company.sector} />
            <SignalTypeSet points={company.whyNow} />
            <span className="num font-mono text-2xs text-muted-foreground">
              {company.trigger.source.date}
            </span>
          </span>
          <SignalBadge
            expansion={company.trigger.expansion}
            partnership={company.trigger.partnership}
            momentum={company.trigger.momentum}
            companyName={company.name}
            className="shrink-0"
          />
        </div>
        <div>
          <CompanyHeading company={company} note={note} />
          <OneLiner text={company.oneLiner} />
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <a
              href={company.trigger.source.url}
              target="_blank"
              rel="noreferrer"
              className="measure text-sm leading-snug text-muted-foreground link-underline hover:text-foreground"
            >
              {company.trigger.headline}
            </a>
            <SourceLink source={company.trigger.source} />
          </div>
        </div>
      </div>

      {/* Assessment zone: the hard numbers first, then the four judgments as
          meters. Funding and headcount are facts about the company; the bands
          are a reading of it, and the two should not look alike. */}
      <div className="px-5 pb-4 sm:px-7">
        <FactGrid
          // Every figure carries where it came from, not only the valuation:
          // a reader judging staleness needs the provider and the date, and a
          // generic caveat on one cell implied the others had no provenance.
          items={[
            {
              name: "Total raised",
              value: company.fundingTotal,
              noteDetail: company.factSources["Total raised"],
            },
            {
              name: "Valuation",
              value: company.valuation?.value ?? "Unknown",
              noteDetail: company.factSources.Valuation,
            },
            {
              name: "Headcount",
              value: company.headcount,
              noteDetail: company.factSources.Headcount,
            },
            {
              name: "Last round",
              value: company.lastRound ?? "Unknown",
              noteDetail: company.factSources["Last round"],
            },
          ]}
        />
        {/* The bands are what a reader wants at a glance: whether this company
            is worth their attention at all. Compact here with the reasoning on
            hover; the panel writes it out. */}
        <BandMeterSet
          className="mt-3"
          items={[
            { name: "Priority", band: a.priority, reason: a.bandReasons.priority },
            { name: "SG fit", band: a.sgFit, reason: a.bandReasons.sgFit },
            {
              name: "Value",
              band: company.potentialValue.band,
              // The dimensions say what the band is high *in*, so they belong
              // with the reasoning rather than crowding the meter row.
              reason:
                company.potentialValue.dimensions.length > 0
                  ? `${a.bandReasons.contribution} Driven by ${company.potentialValue.dimensions.join(", ")}.`
                  : a.bandReasons.contribution,
            },
            {
              name: "Conf.",
              band: company.potentialValue.confidence,
              reason: a.bandReasons.confidence,
            },
          ]}
        />
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1 rounded-b-md py-1.5 text-2xs uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <ChevronDown className="size-3" strokeWidth={2} aria-hidden />
        Why now, and the full case
      </button>

      {/* Actions stay on the card rather than behind the toggle. They are what
          the pilot measures, and a disposition that costs an extra click to
          reach is a disposition that does not get recorded. */}
      <div className="space-y-2.5 rounded-b-md border-t border-[color:var(--hairline)] bg-muted/30 p-5 sm:px-7">
        <FamiliarityControl company={company} />
        <DispositionControls company={company} preselect={preselect} />
      </div>

      {/* The detail opens in an overlay rather than in place. Growing a card
          inside a masonry column pushes everything below it down and re-flows
          the other columns, which is disorienting while reading. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-[2px] duration-200 animate-in fade-in sm:p-8"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="panel-scale my-auto w-full max-w-2xl overflow-hidden rounded-md border border-border bg-card shadow-lg duration-200 animate-in fade-in zoom-in-[0.98]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={company.name}
          >
            <div className="flex items-baseline justify-between gap-x-4 border-b border-[color:var(--hairline)] px-5 py-3">
              <span className="font-display text-base font-semibold tracking-tight">
                {company.name}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-2xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
      {/* Evidence zone */}
      <div className="space-y-6 p-5 sm:p-7">
        <div className="space-y-2">
          <Label>Why now</Label>
          <WhyNow points={company.whyNow} />
        </div>


        {/* What Singapore would actually put on the table. The bands say how much
            we care and their hovers say why; this is the only place the card
            names the offer itself, which is what an approach is built on. */}
        {(company.offer || company.checkFirst) && (
          <div className="space-y-1.5 rounded-md border border-[color:var(--hairline)] bg-muted/50 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-x-3">
              <Label>Singapore could offer</Label>
              {/* The caution is about what can be offered — export control limits
                  what could be sited here — so it belongs with the offer rather
                  than beside the company name. */}
              {company.checkFirst && <CheckFirst text={company.checkFirst} />}
            </div>
            {company.offer && (
              <>
            <p className="measure text-sm font-medium">
              {company.offer.title}
              <span className="ml-2 font-mono text-2xs font-normal uppercase tracking-[0.12em] text-accent-foreground">
                {offerTierLabel[company.offer.tier]}
              </span>
            </p>
            <p className="measure text-sm text-muted-foreground">
              {company.offer.precedent} <SourceLink source={company.offer.precedentSource} />
            </p>
            {company.offer.caveat && (
              <p className="measure text-xs text-muted-foreground">
                Caveat — {company.offer.caveat}
              </p>
            )}
              </>
            )}
          </div>
        )}

        {/* A path when the graph found one; the people at the company when it
            did not. "No path found" answers a question nobody asked — the one
            being asked is who to call. */}
        <div className="space-y-1.5">
          <Label>{company.possiblePathSummary ? "Possible path" : "Who to approach"}</Label>
          {company.possiblePathSummary ? (
            <p className="measure text-sm italic text-muted-foreground">
              {company.possiblePathSummary}
            </p>
          ) : company.contacts.length > 0 ? (
            <>
              <p className="measure text-xs text-muted-foreground">
                No connection found in the graph, so this is {company.name} directly.
              </p>
              <ul className="space-y-1">
                {company.contacts.map((p, i) => (
                  // Two people can share a name; the position is what is unique.
                  <li key={`${p.name}-${i}`} className="text-sm">
                    <span className="font-medium">{p.name}</span>
                    {p.title && <span className="text-muted-foreground"> · {p.title}</span>}
                    {p.email && (
                      <>
                        {" · "}
                        <a href={`mailto:${p.email}`} className="link-underline">{p.email}</a>
                      </>
                    )}
                    {!p.email && p.profileUrl && (
                      <>
                        {" · "}
                        <a href={p.profileUrl} target="_blank" rel="noreferrer" className="link-underline">
                          {profileLabel(p.profileUrl)}
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="measure text-sm italic text-muted-foreground">
              No connection and no named contact yet. Nothing public has been scraped for{" "}
              {company.name}, which is not the same as nothing existing.
            </p>
          )}
          <Link href={`/company/${company.id}`}
            className="inline-block text-xs text-muted-foreground link-underline hover:text-foreground"
          >
            {company.possiblePathSummary ? "See all possible paths" : "See everyone we have"}
          </Link>
        </div>
      </div>

          </div>
        </div>
      )}
    </article>
  );
}
