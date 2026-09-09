import { CompanyCase } from '@/components/company-case';
import { Masonry } from '@/components/masonry';
import { SectionHeading } from '@/components/primitives';
import type { DashboardCompany } from '@/lib/ui-types';

/**
 * One section of the dashboard.
 *
 * Geography used to be three tabs inside every section, each with its own
 * state, on the reasoning that the question is asked per section. In practice
 * the sections then disagreed: "worth a conversation" could be showing
 * International while "new on the radar" showed the West Coast, and nothing on
 * the page said so. The filter now lives once in the sidebar and is written to
 * the URL, so every section answers the same question and a narrowed view is a
 * link rather than a state nobody can see.
 *
 * What is left here is a heading, a count and the cards.
 */
export function GeographySection({
  title,
  blurb,
  companies,
  empty,
  id,
}: {
  title: string;
  blurb?: string;
  companies: DashboardCompany[];
  empty: string;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <SectionHeading
        title={title}
        blurb={blurb}
        right={
          <span className="num text-2xs text-muted-foreground">
            {companies.length} {companies.length === 1 ? 'company' : 'companies'}
          </span>
        }
      />
      {companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Masonry className="dense-cards">
          {companies.map((c) => (
            <CompanyCase key={c.id} company={c} />
          ))}
        </Masonry>
      )}
    </section>
  );
}
