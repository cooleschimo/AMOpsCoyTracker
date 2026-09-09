"use client";

import { ArrowUpRight, ChevronRight, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { broadSectorLabel, sectorBroadSector, sectorLabel, sectorShort } from "@/lib/subsectors";
import type {
  Familiarity,
  Band,
  DismissReason,
  EvidencePoint,
  Feasibility,
  OfferTier,
  PathKind,
  PathReviewStatus,
  Sector,
  SignalType,
  Source,
} from "@/lib/ui-types";

export const signalTypeLabel: Record<string, string> = {
  funding: "Funding",
  expansion: "Expansion",
  hiring: "Hiring",
  partnership: "Partnership",
  leadership: "Leadership",
  product_launch: "Product launch",
  ma: "M&A",
  regulatory: "Regulatory",
  award: "Award",
  other: "Other",
  noise: "Noise",
};

export const bandLabel: Record<Band, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

/**
 * Labels come from the taxonomy rather than a list kept here, so a subsector
 * added to lib/subsectors.ts shows its name instead of its id.
 */
export { sectorLabel, sectorShort, broadSectorLabel };

export const familiarityLabel: Record<Familiarity, string> = {
  no_status: "No status",
  known: "Known",
  in_conversation: "In conversation",
  not_known: "Not known",
};

export const familiarityHelp: Record<Familiarity, string> = {
  no_status: "Nobody has said either way. Not the same as having checked.",
  known: "Engaged with a few times and known reasonably well.",
  in_conversation: "Talking to them right now.",
  not_known: "Checked — no real relationship here.",
};

export const dismissReasonLabel: Record<DismissReason, string> = {
  irrelevant_company: "Irrelevant company",
  too_early: "Too early",
  no_sg_angle: "No Singapore angle",
  already_tracked: "Already tracked",
};

export const dismissReasonFeedback: Record<DismissReason, string> = {
  irrelevant_company: "dismissals for 'irrelevant company' tune the company assessment axis",
  too_early: "dismissals for 'too early' tune the stage threshold, not the relevance rubric",
  no_sg_angle: "dismissals for 'no Singapore angle' tune the scoring rubric",
  already_tracked: "dismissals for 'already tracked' tune deduplication against the account list",
};

export const pathKindLabel: Record<PathKind, string> = {
  person_role: "Person / role",
  fund_portfolio: "Fund portfolio",
  company_edge: "Company edge",
  event: "Event",
};

export const pathReviewLabel: Record<PathReviewStatus, string> = {
  unreviewed: "Unreviewed",
  usable: "Usable connection",
  needs_verifying: "Potential, needs verifying",
  not_usable: "Not usable",
  not_sure: "Not sure",
};

export const feasibilityLabel: Record<Feasibility, string> = {
  confirmed: "1 · Confirmed edge",
  plausible: "2 · Plausible",
  weak: "3 · Weak",
};

export const offerTierLabel: Record<OfferTier, string> = {
  available_now: "Available now",
  underway: "Underway",
  exploratory: "Exploratory",
};

/* ---------------------------------------------------------------- */

export function SourceLink({ source, label }: { source: Source; label?: string }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-0.5 text-2xs text-primary/80 link-underline hover:text-primary"
    >
      {label ?? source.name}
      <span className="num opacity-70"> · {source.date}</span>
      <ArrowUpRight className="size-3 shrink-0 self-center" strokeWidth={1.5} />
    </a>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* Mono metadata row — the quiet dateline above each entry */
export function MetaRow({
  left,
  right,
  className,
}: {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5", className)}
    >
      {/* No type treatment here: the children own theirs. A mono/uppercase
          wrapper flattened a coloured sector tag and a plain word list into one
          undifferentiated strip. */}
      <span className="min-w-0">{left}</span>
      {right && <span className="num font-mono text-2xs text-muted-foreground">{right}</span>}
    </div>
  );
}

/* Hairline stat grid — bands at a glance, editorial ledger style */
/**
 * A band as a three-segment meter. Colour and fill both carry the value, and
 * the label stays readable, so it survives a greyscale print and a colourblind
 * reader. 'unknown' fills nothing and says so rather than showing an empty bar
 * that could read as low.
 */
/**
 * Labels abbreviated to fit the card, spelled out in the hover.
 *
 * The card's label column is narrow enough that a long label either leaves a
 * gap before its value or pushes the value out of alignment. The hover has room
 * for the full word, which is where a reader unsure what a band means will look.
 */
const METER_FULL_NAME: Record<string, string> = {
  "Conf.": "Confidence",
  "SG fit": "Singapore fit",
  Value: "Potential value",
};

export function BandMeter({
  name,
  band,
  reason,
  className,
}: {
  name: string;
  band: Band;
  /** Why this band landed here. Shown on hover — a band alone is not arguable. */
  reason?: string | undefined;
  className?: string | undefined;
}) {
  const filled: Record<Band, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
  const fillColor: Record<Band, string> = {
    high: "bg-primary",
    medium: "bg-primary/55",
    low: "bg-primary/30",
    unknown: "bg-transparent",
  };
  const textColor: Record<Band, string> = {
    high: "text-primary",
    medium: "text-foreground",
    low: "text-muted-foreground",
    unknown: "italic text-muted-foreground/70",
  };
  const n = filled[band];

  const row = (
    <div
      className={cn(
        "flex items-center gap-x-2.5",
        reason && "cursor-help rounded-sm transition-colors hover:bg-muted/60",
        className,
      )}
    >
      <div className="flex shrink-0 gap-0.5" role="img" aria-label={`${name}: ${bandLabel[band]}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("meter-bar h-3.5 w-1.5 rounded-[1px]", i < n ? fillColor[band] : "bg-border")}
          />
        ))}
      </div>
      {/* Fixed label column keeps values on a common left edge across rows. */}
      <span
        className={cn(
          "meter-label w-[5.5rem] shrink-0 text-2xs uppercase tracking-[0.1em] text-muted-foreground",
          // Underlined at rest, not on hover: an affordance that only appears
          // once you are already hovering cannot tell you the thing is there.
          reason && "underline decoration-dotted decoration-from-font underline-offset-[3px]",
        )}
      >
        {name}
      </span>
      <span className={cn("min-w-0 text-sm font-medium leading-none", textColor[band])}>
        {bandLabel[band]}
      </span>
    </div>
  );

  if (!reason) return row;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button type="button" className="group -mx-1.5 px-1.5 py-1 text-left">
          {row}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80">
        <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
          {METER_FULL_NAME[name] ?? name} · {bandLabel[band]}
        </p>
        <p className="mt-2 text-sm leading-relaxed">{reason}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The four assessment bands as meters — one compact block instead of a wide grid. */
export function BandMeterSet({
  items,
  className,
}: {
  items: { name: string; band: Band; reason?: string | undefined }[];
  className?: string | undefined;
}) {
  return (
    <div className={cn("band-meters grid gap-x-8 gap-y-1.5 sm:grid-cols-2", className)}>
      {items.map((it) => (
        <BandMeter key={it.name} name={it.name} band={it.band} reason={it.reason} />
      ))}
    </div>
  );
}

/**
 * Hard facts about the company — funding, valuation, headcount. These are
 * figures rather than judgments, so they read plainly and carry their source
 * where one exists.
 */
/**
 * The bands with their reasoning written out, one per line.
 *
 * The compact meter hides its reason behind a hover, which suits a card being
 * scanned. In the panel there is room to show it, and a reader who has opened
 * the panel is reading rather than scanning — asking them to hover four times
 * to get the argument would be work for its own sake.
 */
export function BandMeterList({
  items,
  className,
}: {
  items: { name: string; band: Band; reason?: string | undefined }[];
  className?: string | undefined;
}) {
  return (
    <dl className={cn("space-y-3", className)}>
      {items.map((it) => (
        <div key={it.name}>
          <dt>
            <BandMeter name={it.name} band={it.band} />
          </dt>
          {it.reason && (
            <dd className="mt-1 pl-[1.4rem] text-sm leading-relaxed text-muted-foreground">
              {it.reason}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export function FactGrid({
  items,
  className,
}: {
  items: {
    name: string;
    value: ReactNode;
    /** Caveat behind the figure, shown on hover from the value itself. */
    noteDetail?: string | undefined;
  }[];
  className?: string | undefined;
}) {
  return (
    <dl
      className={cn(
        // No cell borders. Four numbers do not need a table around them, and
        // the rules made a quiet reference row read as the loudest thing on
        // the card. Alignment carries the grouping instead.
        //
        // Two columns is the floor; inside a card the container query in
        // globals.css opens it to four once the card is wide enough to hold
        // the labels. A viewport breakpoint cannot judge that — the window
        // being wide says nothing about a card in a narrow column.
        "fact-grid grid grid-cols-2 gap-x-4 gap-y-2",
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.name}>
          <dt className="font-mono text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {it.name}
          </dt>
          <dd className="num mt-1 text-base font-semibold leading-tight">
            {it.noteDetail ? (
              // The caveat hangs off the figure rather than taking its own line:
              // a reader who trusts the number never has to read it.
              <HoverCard openDelay={120} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className="cursor-help text-left underline decoration-dotted decoration-from-font underline-offset-[3px] hover:decoration-solid"
                  >
                    {it.value}
                    {/* A dotted underline, not a query mark: the hover names
                        where the figure came from, which is provenance rather
                        than a caution about its reliability. */}
                  </button>
                </HoverCardTrigger>
                {/* font-normal: the panel sits inside the <dd>, which is
                    semibold for the figure itself, and the source text would
                    otherwise inherit that weight. */}
                <HoverCardContent align="start" className="w-80 font-normal">
                  <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                    {it.name} · source
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{it.noteDetail}</p>
                </HoverCardContent>
              </HoverCard>
            ) : (
              it.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function BandValue({
  name,
  band,
  className,
}: {
  name: string;
  band: Band;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{name}</span>
      <span
        className={cn(
          "text-sm leading-tight",
          band === "unknown" ? "italic text-muted-foreground" : "text-foreground",
        )}
      >
        {bandLabel[band]}
      </span>
    </div>
  );
}


/** What each axis asks, and what a level means on it. */
export const AXIS_SCALE = {
  expansion: {
    label: "Siting",
    question: "Is this company deciding where to put something?",
    levels: [
      "No siting decision visible.",
      "Growing, but nothing about where.",
      "Moving into new markets, no location named.",
      "Choosing where to put a facility, a region lead, or newly raised money.",
    ],
  },
  partnership: {
    label: "Opening",
    question: "Is there something EDB could propose into?",
    levels: [
      "Nothing to propose into.",
      "Possible in principle, nothing concrete.",
      "Building the kind of thing a partner could join.",
      "Actively seeking partners, testbeds or joint work.",
    ],
  },
  momentum: {
    label: "Pace",
    question: "Is this company accelerating?",
    levels: [
      "Quiet.",
      "Steady.",
      "Moving — raising, growing, winning customers.",
      "Moving fast, and visibly.",
    ],
  },
} as const;

export type AxisKey = keyof typeof AXIS_SCALE;

function AxisDots({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i <= value ? "bg-current" : "bg-current opacity-25",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The three axes the company was scored on, as one mark.
 *
 * Showing only the strongest made every card read alike, because qualifying
 * requires a 3 on siting or opening — the badge just restated the entry bar. It
 * also flattened a real difference: a company choosing where to build and one
 * looking for a partner need different approaches, and the badge called both
 * the same thing.
 */
export function SignalBadge({
  expansion,
  partnership,
  momentum,
  companyName,
  className,
}: {
  expansion: number;
  partnership: number;
  momentum: number;
  /** Named in the explanation, so it reads as this company's situation. */
  companyName: string;
  className?: string;
}) {
  const axes: Array<{ key: AxisKey; value: number }> = [
    { key: "expansion", value: expansion },
    { key: "partnership", value: partnership },
    { key: "momentum", value: momentum },
  ];
  // Named for whichever opening is stronger: that is the approach an RD would
  // actually make, and it is what the placement rule keyed on.
  const lead: AxisKey = partnership > expansion ? "partnership" : "expansion";

  // Deliberately hueless. The sector tags own the colour wheel, and a badge
  // beside a deeptech tag in the same blue read as one label in two halves.
  const strength = Math.max(expansion, partnership);
  const tone =
    strength >= 3
      ? "bg-foreground text-background ring-transparent"
      : strength === 2
        ? "bg-foreground/[0.08] text-foreground ring-foreground/15"
        : "bg-transparent text-muted-foreground ring-border";

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Siting ${expansion} of 3, opening ${partnership} of 3, pace ${momentum} of 3`}
          className={cn(
            "inline-flex cursor-help items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset transition-opacity hover:opacity-80",
            tone,
            className,
          )}
        >
          <AxisDots value={Math.max(expansion, partnership)} />
          <span className="text-2xs font-medium uppercase tracking-[0.1em]">
            {AXIS_SCALE[lead].label}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80">
        <dl className="space-y-3">
          {axes.map(({ key, value }) => (
            <div key={key}>
              <dt className="flex items-center gap-2">
                <AxisDots value={value} />
                <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                  {AXIS_SCALE[key].label}
                </span>
              </dt>
              <dd className="mt-0.5 pl-[1.4rem] text-sm leading-relaxed">
                {AXIS_SCALE[key].levels[value] ?? AXIS_SCALE[key].levels[0]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-border pt-2 text-2xs leading-relaxed text-muted-foreground">
          What is happening at {companyName} right now. Whether it is a company worth pursuing is a
          separate judgment, shown below.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Colour is assigned on the broad sector, not the subsector: four hues across
 * twenty-six values would be arbitrary, and the reader is scanning for family
 * anyway. Anything outside the four defined hues is deliberately neutral —
 * colour is meaning here, and inventing a hue would imply one.
 */
const BROAD_HUE: Partial<Record<string, string>> = {
  compute: "deeptech", industrial: "deeptech", aerospace: "deeptech",
  health: "biotech",
  defence: "defence",
  ai: "ai",
};

const hueFor = (sector: string) => {
  const broad = sectorBroadSector(sector) ?? sector;
  return BROAD_HUE[broad];
};

const sectorColor = (sector: string) => {
  const h = hueFor(sector);
  return h ? `text-sector-${h}` : "text-muted-foreground";
};

const sectorBg = (sector: string) => {
  const h = hueFor(sector);
  return h ? `bg-sector-${h}/12` : "bg-muted";
};

/*
 * Sector tags — the one place colour is used for categorisation.
 *
 * Two tags, because the taxonomy has two levels and collapsing them loses the
 * one a reader scans by. The broad sector is the family and carries the colour;
 * the subsector is the precise reading and sits alongside it in outline. Both
 * use the short form: a tag has room for a word, and the full label is a
 * definition written for the classifier, not a caption.
 */
export function SectorTag({ sector, className }: { sector: string; className?: string }) {
  const broad = sectorBroadSector(sector);
  const isSub = Boolean(broad);
  const family = broad ?? sector;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        className={cn(
          "sector-tag inline-flex w-fit items-center justify-center gap-1.5 rounded-sm px-1.5 py-0.5 text-center font-mono text-2xs font-semibold uppercase leading-tight tracking-[0.16em] [text-indent:0.16em]",
          sectorColor(family),
          sectorBg(family),
        )}
        title={broadSectorLabel(family)}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {sectorShort(family)}
      </span>
      {isSub && (
        <span
          className={cn(
            // Letter-spacing adds a trailing gap after the last character, which
            // reads as the box being too wide on a long label. Compensated with
            // a negative right margin so the text sits centred in its box.
            // The label may wrap; the box then shrinks to its longest wrapped
            // line rather than holding the full unwrapped width. Text is
            // centred so a short second line does not sit ragged left.
            "subsector-tag inline-block w-fit rounded-sm border px-1.5 py-0.5 text-center font-mono text-2xs font-medium uppercase leading-tight tracking-[0.16em] [text-indent:0.16em]",
            sectorColor(family),
            "border-current/25",
          )}
          title={sectorLabel(sector)}
        >
          {sectorShort(sector)}
        </span>
      )}
    </span>
  );
}

/* Signal types are per evidence point, so a company shows the set it produced */
export function SignalTypeSet({ points }: { points: EvidencePoint[] }) {
  const types = Array.from(new Set(points.map((p) => p.signalType)));
  if (types.length === 0) return null;
  // Sentence case in the body face. These are ordinary words, and mono with wide
  // tracking made them read as machine output while competing with the sector
  // tag beside them, which is the label that should own that treatment.
  return (
    <span className="signal-types text-xs text-muted-foreground">
      {types.map((t) => signalTypeLabel[t]).join(" · ")}
    </span>
  );
}

/**
 * This point's item arrived in today's run.
 *
 * The pipeline runs daily but a company holds its place for the whole week, so
 * by midweek the dashboard is mostly names the reader has already seen. The
 * mark sits on the POINT rather than the card because that is what actually
 * changed: a company surfaced on Monday can pick up a new item on Thursday, and
 * that item is the reason to look again.
 *
 * A bubble, not a tag. The card already carries a sector tag, a signal-type set
 * and sometimes a caution mark, all bordered pills — a fourth in that shape
 * reads as another category rather than as news. This is the notification dot
 * the shape is borrowed from everywhere else, with the count in the title.
 */
export function NewTodayTag({ count, items }: { count?: number; items?: EvidencePoint[] }) {
  const [shown, setShown] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const label = count && count > 1 ? `${count} new items today` : 'New item today';
  const list = items?.filter((p) => p.isNew) ?? [];

  /*
   * The reveal closes itself. This is a glance — what arrived — not a panel to
   * work in, and a reader who clicked it is still scanning the grid rather than
   * reading one card. Any click anywhere closes it early.
   */
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 6000);
    const close = () => setShown(false);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [shown]);

  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={shown}
        onClick={(e) => {
          e.stopPropagation();
          const r = ref.current?.getBoundingClientRect();
          // Viewport coordinates, kept clear of the right edge — the panel is
          // fixed, so it is positioned against the window rather than the card.
          if (r) setAt({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 340) });
          setShown((v) => !v);
        }}
        className={cn(
          "cursor-pointer font-mono text-[0.65rem] font-semibold lowercase tracking-[0.1em] text-fresh",
          // The glow is the whole signal: it says look here without spending the
          // space a badge would, and it separates a fact that just arrived from
          // the judgments the rest of the card carries.
          "transition-[text-shadow,opacity] duration-200",
          "[text-shadow:0_0_6px_var(--fresh),0_0_12px_var(--fresh)]",
          "hover:opacity-80 hover:[text-shadow:0_0_8px_var(--fresh),0_0_18px_var(--fresh)]",
        )}
      >
        new{count && count > 1 ? ` ${count}` : ''}
      </button>

      {/*
        * Rendered into the body, not the card. The card clips its own children
        * to keep its rounded corners, so a panel positioned inside it was cut
        * off at the card's edge — which for a small card meant almost all of it.
        */}
      {shown && list.length > 0 && at && createPortal(
        <span
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          style={{ top: at.top, left: at.left }}
          className="fixed z-50 w-80 rounded-md border border-fresh/30 bg-popover p-3 shadow-lg"
        >
          <span className="mb-1.5 block font-mono text-2xs uppercase tracking-[0.1em] text-fresh">
            arrived today
          </span>
          <span className="block space-y-1.5">
            {list.map((p) => (
              <span key={p.id} className="block text-2xs leading-snug text-popover-foreground">
                {p.text}
                <span className="ml-1.5 text-muted-foreground">{p.source.name}</span>
              </span>
            ))}
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}

function NewToday() {
  return (
    <span
      title="Arrived today"
      aria-label="Arrived today"
      className="ml-1.5 inline-flex size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-fresh align-middle"
    />
  );
}

export function WhyNow({ points }: { points: EvidencePoint[] }) {
  return (
    <ul className="measure space-y-2">
      {points.map((p) => (
        <li key={p.id} className="flex gap-2.5 text-sm leading-relaxed">
          <span
            className={cn(
              "mt-[0.6em] size-1 shrink-0 rounded-full",
              p.origin === "headline_signal" ? "bg-foreground/70" : "bg-foreground/25",
            )}
            aria-hidden
          />
          <span>
            {p.text}
            {p.isNew ? <NewToday /> : null}
            <span className="ml-2 whitespace-nowrap text-2xs text-muted-foreground">
              {signalTypeLabel[p.signalType]}
              {p.origin === "headline_signal" ? " · headline signal" : " · supporting"}
            </span>
            <span className="ml-2">
              <SourceLink source={p.source} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ModelNote({ children }: { children: ReactNode }) {
  return <p className="measure text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * A caution to verify before approaching — export control, mostly.
 *
 * A mark rather than a block: it applies to a minority of companies, and a
 * full-width panel on those cards alone breaks the rhythm of a grid of
 * otherwise-equal cards. The warning is still one hover away, and the mark is
 * coloured so a reader scanning the grid can see which companies carry one.
 */
export function CheckFirst({ text }: { text: string }) {
  return (
    <HoverCard openDelay={100} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Check first: ${text}`}
          className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-caution/40 bg-caution-soft/60 px-1.5 py-0.5 text-caution transition-opacity hover:opacity-80"
        >
          <TriangleAlert className="size-3" strokeWidth={2} aria-hidden />
          <span className="font-mono text-2xs font-medium uppercase tracking-[0.1em]">Check</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80">
        <p className="font-mono text-2xs font-medium uppercase tracking-[0.12em] text-caution">
          Check first
        </p>
        <p className="mt-2 text-sm leading-relaxed">{text}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

export function FeasibilityMark({ feasibility }: { feasibility: Feasibility }) {
  const color =
    feasibility === "confirmed"
      ? "text-confirmed"
      : feasibility === "plausible"
        ? "text-plausible"
        : "text-weak";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-2xs", color)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {feasibilityLabel[feasibility]}
    </span>
  );
}

export function QuietButton({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary",
        "transition-colors duration-200 ease-out",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring",
        active &&
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A section held closed until it is asked for.
 *
 * Some sections are answers to questions an RD only sometimes has — what the
 * tool judged weak, what it has not judged yet. They belong on the week's page,
 * because a judgment nobody can see is one nobody can correct, but open they
 * would push the sections carrying a live argument off the screen.
 *
 * So the heading is the whole control: the same rule and count as every other
 * section, plus what it is for, and it opens in place. That reads as part of
 * the page rather than as a footnote bolted to the bottom of it, which two
 * stacked link paragraphs did not.
 */
export function CollapsedSection({
  title,
  blurb,
  count,
  children,
}: {
  title: string;
  blurb: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group w-full cursor-pointer border-b border-border pb-3 text-left transition-colors hover:border-primary"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="flex items-baseline gap-2">
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 translate-y-0.5 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
              strokeWidth={2}
              aria-hidden
            />
            <span className="font-display text-lg tracking-tight text-muted-foreground transition-colors group-hover:text-foreground">
              {title}
            </span>
            <span className="num text-2xs text-muted-foreground">{count}</span>
          </span>
          <span className="text-2xs text-muted-foreground">
            {open ? 'hide' : 'show'}
          </span>
        </span>
        <span className="mt-1 block pl-[1.4rem] text-sm text-muted-foreground">
          {blurb}
        </span>
      </button>

      {open && <div className="pt-2">{children}</div>}
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  blurb,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A sentence saying what the section holds. */
  blurb?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="border-b-2 border-primary pb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        {/* Held below the page title. At sm: this matched the h1 exactly, so a
            section read as important as the page it sits inside. */}
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        {right}
      </div>
      {subtitle && (
        <p className="measure mt-1.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {subtitle}
        </p>
      )}
      {/* Sentence case, unlike `subtitle`: this says what the section is, and
          sits in the same column as a collapsed section's blurb, so the voice
          should not change with whether a section happens to be open. */}
      {blurb && <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>}
    </div>
  );
}
