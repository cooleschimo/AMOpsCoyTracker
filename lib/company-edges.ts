/**
 * Company-to-company relationships read out of news. Brief §4, §12 step 16.
 *
 * The graph knows who invested in a company and who works there. It does not
 * know that one company bought another, or that two are building something
 * together — and those are the relationships an RD can lead with, because they
 * are announcements the companies made about themselves rather than inferences
 * from a filing.
 *
 * `lib/paths.ts` has read `company_edges` as a warm path since it was written.
 * The table was empty, so that path never fired.
 *
 * Three rules the extraction turns on:
 *
 *  1. **Direction is part of the fact.** "Jazz Pharmaceuticals acquires Actio
 *     Biosciences" and the reverse are different events, and an edge that loses
 *     the direction says something false. Acquisitions, spin-outs and
 *     subsidiary relationships are directed; partnerships and collaborations
 *     are not.
 *
 *  2. **An undirected relation is ONE row, ordered by id.** Storing a
 *     partnership from both sides duplicates every traversal through it and
 *     inflates every warm-path result — the brief says so outright, and
 *     `canonicalEdge` is where that is enforced rather than left to callers.
 *
 *  3. **Both companies must already be in the graph.** A headline names
 *     customers, agencies, government departments and every company mentioned
 *     in passing; creating rows for those would fill the table with entities
 *     nothing else in the pipeline tracks. An edge to a company we do not hold
 *     leads nowhere, which is the definition of not being a path.
 */
import { callJson } from './llm';
import type { Budget } from './budget';

/** The relations the schema names. Anything else is not recorded. */
export const RELATIONS = [
  'acquired', 'subsidiary_of', 'partnership', 'customer_of', 'supplier_to', 'spun_out_of',
] as const;
export type Relation = (typeof RELATIONS)[number];

export const isRelation = (v: string): v is Relation =>
  (RELATIONS as readonly string[]).includes(v);

/**
 * Which relations carry a direction.
 *
 * A partnership between A and B is the same fact read from either end. An
 * acquisition is not, and neither is a supply relationship: who buys from whom
 * is most of what the edge says.
 */
export const DIRECTED: Record<Relation, boolean> = {
  acquired: true,
  subsidiary_of: true,
  spun_out_of: true,
  customer_of: true,
  supplier_to: true,
  partnership: false,
};

export type Edge = {
  fromCompanyId: number;
  toCompanyId: number;
  relation: Relation;
  directed: boolean;
  announcedDate: string | null;
  sourceUrl: string | null;
};

/**
 * The row as it must be stored.
 *
 * For an undirected relation the lower id always goes in `from`, so the pair
 * has exactly one representation and the unique index actually prevents the
 * duplicate. Without this the same partnership announced twice — once by each
 * company's press release — becomes two rows that both match a traversal.
 *
 * Returns null for a self-edge, which a headline naming one company twice
 * ("Anduril acquires Anduril Industries" after a name match on both sides)
 * would otherwise produce.
 */
export function canonicalEdge(
  a: number, b: number, relation: Relation,
): { fromCompanyId: number; toCompanyId: number; directed: boolean } | null {
  if (a === b) return null;
  const directed = DIRECTED[relation];
  if (directed) return { fromCompanyId: a, toCompanyId: b, directed };
  return {
    fromCompanyId: Math.min(a, b),
    toCompanyId: Math.max(a, b),
    directed: false,
  };
}

/**
 * Read the relationship out of a headline.
 *
 * The prompt is written to refuse, for the same reason every extraction here
 * is: an edge becomes a sentence on a company page claiming two real companies
 * have a relationship, and a wrong one sends an RD into a conversation with a
 * false premise. Most headlines about a company describe something it did
 * alone, and "no relationship stated" is the common and correct answer.
 *
 * The names come back as written and are resolved against the graph by the
 * caller. Asking the model to pick from a list of three thousand companies
 * would not fit, and asking it to guess an id invites invention.
 */
export const COMPANY_EDGE_SYSTEM = `You read a news headline about companies and say what relationship it states between two of them.

Most headlines describe one company doing something on its own — raising money, launching a product, hiring, reporting results. Those state no relationship, and returning nothing is the correct answer for them. Only a headline that says two named companies are connected produces an answer.

The relationships, and what each one means:
- acquired: the first company is buying or has bought the second
- subsidiary_of: the first is owned by the second
- spun_out_of: the first was created out of the second
- partnership: the two are working together — a collaboration, a joint project, an alliance, a signed agreement to build something jointly
- customer_of: the first buys the second's product
- supplier_to: the first supplies the second

Order matters for every one except partnership. "Jazz acquires Actio" means from=Jazz, to=Actio; getting it backwards states the opposite of what happened.

Return nothing when: the headline only mentions both companies without connecting them ("Nvidia and AMD both fell today"), when a deal is rumoured, denied, abandoned or merely explored, when one party is an investor putting money in rather than a business partner, or when one side is a government department, agency, university or industry body rather than a company. A funding round is not a partnership and an investor is not an acquirer.

Three shapes that read like a relationship and are not:
- A product sold, listed, discounted or reviewed somewhere. "Apple Studio Display returns to Amazon at $100 off" is a retail price, not Apple supplying Amazon. A marketplace carrying a product is not a customer of its maker.
- A product NAMED after another company's hardware. "Bitget lists Nvidia H100 perpetuals" is a financial instrument tracking a chip; the two companies have no dealing with each other. The same goes for a fund, index or benchmark that references a company.
- A parent announcing something built on what it already owns. Broadcom owns VMware, so "Broadcom introduces VMware Private AI Cloud" is one company shipping its own product, not two companies partnering. Where one company owns the other, the only relationship a headline can state is that ownership.

An announced deal that has not closed is still the relationship it announces, so report it. A deal that failed is not — "Cognition Rebuffs SpaceX Buyout" states no relationship.

Being wrong costs more than being silent. Each answer becomes a claim on a company's page that these two organisations are connected, read by someone about to open a conversation on the strength of it.

Return JSON only: {"results":[{"n":<the item number>,"from":"<company name>","to":"<company name>","relation":"<one of the six>","why":"<the words in the headline that show it>"}]}
Items with no relationship are simply left out of the array.`;

export type ExtractedEdge = {
  n: number;
  from: string;
  to: string;
  relation: Relation;
  why: string;
};

type ExtractOut = {
  results?: Array<{ n?: number; from?: string; to?: string; relation?: string; why?: string }>;
};

export type EdgeCandidate = {
  itemId: number;
  title: string;
  snippet?: string | null;
  url: string;
  publishedAt?: string | null;
};

/**
 * One call per batch of headlines. A batch that fails costs its own items and
 * not the run; they keep their status and are read again next time.
 */
export async function extractEdges(
  items: EdgeCandidate[],
  opts: { budget?: Budget } = {},
): Promise<{ edges: ExtractedEdge[]; failed: boolean }> {
  if (!items.length) return { edges: [], failed: false };

  const user = `Say what relationship each headline states between two named companies, or leave it out.\n\n${
    items.map((it, i) => {
      const snip = (it.snippet ?? '').replace(/\s+/g, ' ').slice(0, 200);
      return `${i + 1}. ${it.title}${snip ? `\n   ${snip}` : ''}`;
    }).join('\n\n')
  }`;

  const res = await callJson<ExtractOut>({
    system: COMPANY_EDGE_SYSTEM, user, budget: opts.budget, reasoningEffort: 'low',
  });
  if (!res.ok || !Array.isArray(res.data?.results)) return { edges: [], failed: true };

  const out: ExtractedEdge[] = [];
  for (const r of res.data.results) {
    const n = Number(r.n);
    const from = (r.from ?? '').trim();
    const to = (r.to ?? '').trim();
    const relation = (r.relation ?? '').trim().toLowerCase();
    if (!Number.isFinite(n) || n < 1 || n > items.length) continue;
    if (!from || !to || !isRelation(relation)) continue;
    // A headline naming one company on both sides carries no relationship.
    if (from.toLowerCase() === to.toLowerCase()) continue;
    out.push({ n, from, to, relation, why: (r.why ?? '').trim().slice(0, 200) });
  }
  return { edges: out, failed: false };
}
