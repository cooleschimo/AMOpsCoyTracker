/**
 * The pipeline's stages, in dependency order.
 *
 * Shared by the runner and the dev endpoints so the two cannot disagree about
 * which stages exist or what each one costs — a manual re-run that named a
 * stage the weekly run did not have would be a debugging tool that lies.
 */
/**
 * What a stage spends.
 *
 * 'llm' stages draw on the shared daily allowance in lib/budget.ts; 'fetch'
 * stages only cost network time. The distinction is the one that matters when a
 * run goes wrong, because every llm stage fails the same way for the same
 * reason — the allowance is gone, or a key stopped authenticating — and no
 * fetch stage is affected by either. A flat list of twelve names cannot say
 * that, so the summary groups on it.
 */
export type Cost = 'llm' | 'fetch';

/**
 * The phases a run moves through. Named rather than numbered so a failure reads
 * as "nothing was judged this run" instead of "stage 9 of 12 failed".
 */
export type Phase = 'gather' | 'enrich' | 'judge' | 'publish';

export const PHASE_WHAT: Record<Phase, string> = {
  gather: 'find companies and the news about them',
  enrich: 'fill in what the judgment will read',
  judge: 'decide what matters and why',
  publish: 'check the finished set and render it',
};

export type Stage = {
  name: string;
  script: string;
  args?: string[];
  /** Minutes after which the stage is abandoned and the run moves on. */
  timeoutMin: number;
  phase: Phase;
  cost: Cost;
  /** Skipped by --daily: what it reads does not change overnight. */
  weeklyOnly?: boolean;
  why: string;
};

export const STAGES: Stage[] = [
  /*
   * Context and discovery come before the per-company news search, because the
   * search only asks about companies already in the table.
   *
   * Running news first meant a company discovered on Tuesday had no news of its
   * own until Wednesday: it arrived with the single headline that surfaced it,
   * and scoring judged it on that one sentence. Discovering first closes that
   * gap — the same run that finds a company also pulls its news.
   */
  { name: 'context', script: 'ingest-context.ts', timeoutMin: 15, phase: 'gather', cost: 'fetch',
    why: 'the untargeted feeds: policy, sector moves, and the trade press discovery reads' },
  { name: 'discover', script: 'discover-news.ts', timeoutMin: 10, phase: 'gather', cost: 'llm',
    why: 'companies named in untargeted news that we do not track yet' },
  { name: 'news', script: 'ingest-news.ts', timeoutMin: 30, phase: 'gather', cost: 'fetch',
    why: 'Google News per company, including the ones just discovered' },
  /*
   * Enrichment, in dependency order and placed after discovery so a company
   * found this run is filled in on the same run rather than waiting a week.
   *
   * websites before people: ingest-people only considers a company that has a
   * website, so running it first would skip everything discovery just added.
   * location after news, because it reads a company's accumulated headlines
   * rather than the single one that surfaced it.
   */
  /*
   * 45 minutes and a per-run cap. Each company costs a few domain probes and,
   * for a one-word name, a model call to confirm the site is not a different
   * company of the same name — about nine seconds each, so the 272 companies
   * currently without a website would run past any smaller budget. The cap
   * keeps one run bounded as the backlog grows; the rest are picked up next
   * run, strongest signal first.
   */
  /*
   * Sectors before websites, because the same-name check in enrich-websites
   * reads them: they are what tells Aslan the defence-AI company from aslan.ai
   * the Thai finance site. Running it after would judge this run's discoveries
   * on their names alone.
   *
   * Capped, since a full pass measured 28 minutes for 475 companies and the
   * backlog is picked up over successive runs.
   */
  { name: 'sectors', script: 'classify-sectors.ts', args: ['--limit', '200'], timeoutMin: 30, phase: 'enrich', cost: 'llm',
    why: 'the sector every later judgment reads, and the website check corroborates against' },
  { name: 'websites', script: 'enrich-websites.ts', args: ['--limit', '150'], timeoutMin: 45, phase: 'enrich', cost: 'llm',
    why: 'a website is what the assessment reads, and what people scraping needs' },
  /*
   * Two stages, because ingest-people.ts has two modes and running it with no
   * flag does only the funds — which is why company team pages went unscraped
   * while the fund half succeeded daily.
   *
   * Funds first, for the reason the script's own header gives: a Form D
   * director proves a board seat, not a fund affiliation, and the fund team
   * page is the independent second edge that turns an association into a
   * checkable path.
   *
   * Companies is the slow half. Each one probes five URL paths before falling
   * back to a search, measured at about a company a minute, so the cap is what
   * bounds a run and the backlog is picked up over successive runs, strongest
   * signal first. 60 companies is an hour, which is the most this can take
   * without crowding the stages after it.
   */
  { name: 'people_funds', script: 'ingest-people.ts', args: ['--funds'], timeoutMin: 25, phase: 'enrich', cost: 'fetch',
    why: 'the fund-side edge a warm path is checked against' },
  { name: 'people_companies', script: 'ingest-people.ts', args: ['--companies', '--limit', '60'], timeoutMin: 70, phase: 'enrich', cost: 'fetch',
    why: 'the named people §8 builds warm paths from' },
  // After ingest-people, which finds the names this puts a title and bio on.
  // Already scoped to people at companies carrying a live signal, so it is a
  // handful per run rather than the whole graph.
  // A person costs a search plus a model call — about 45 seconds measured — so
  // twenty is a run, not forty. Both stages were killed at their timeouts on the
  // first pass; the cap is what was wrong, not the budget.
  { name: 'bios', script: 'enrich-people.ts', args: ['--limit', '20'], timeoutMin: 20, phase: 'enrich', cost: 'llm',
    why: 'a warm path is worth more when it says who the person is' },
  { name: 'location', script: 'enrich-location.ts', timeoutMin: 15, phase: 'enrich', cost: 'llm',
    why: 'a discovered hq is one headline\'s guess until the rest are read' },
  /*
   * After people, because an exhibitor list names a person who may already be
   * in the graph from a team page, and matching one is better than creating a
   * second row for the same person.
   *
   * Weekly rather than daily. A conference exhibitor list is republished over
   * months, not overnight, and each read costs a model call per chunk of a
   * directory that runs to hundreds of lines.
   */
  { name: 'events', script: 'ingest-events.ts', timeoutMin: 20, phase: 'enrich', cost: 'llm',
    weeklyOnly: true,
    why: 'who from the list will be at which show, and when — the one forward-looking path' },
  // After discovery and websites: a board is found from the company's site, and
  // hiring feeds the momentum axis, so a company discovered this run would
  // otherwise be scored with no hiring evidence at all.
  { name: 'ats', script: 'ingest-ats.ts', timeoutMin: 30, phase: 'enrich', cost: 'fetch',
    why: 'job boards; the hiring snapshot score-companies reads' },
  { name: 'filter', script: 'filter-score.ts', timeoutMin: 45, phase: 'judge', cost: 'llm',
    why: 'canonicalise, drop, cluster, score the items' },
  // After filter: it reads what the filter kept, and only the residue the
  // ambiguity rules could not settle.
  { name: 'ambiguous', script: 'adjudicate-ambiguous.ts', timeoutMin: 20, phase: 'judge', cost: 'llm',
    why: 'headlines about the word, not the company, that no rule can separate' },
  { name: 'rescue', script: 'rescue-mismatch.ts', timeoutMin: 20, phase: 'judge', cost: 'llm',
    why: 'items the name filter dropped that are about the company after all' },
  /*
   * After the filter, because it reads kept items: an edge asserted from a
   * headline the filter went on to drop would outlive the item it came from.
   */
  { name: 'edges', script: 'ingest-edges.ts', args: ['--limit', '800'], timeoutMin: 25, phase: 'judge', cost: 'llm',
    why: 'acquisitions and partnerships between companies we track, which paths read as warm' },
  { name: 'score', script: 'score-companies.ts', timeoutMin: 45, phase: 'judge', cost: 'llm',
    why: 'the three axes per company for this week' },
  { name: 'assess', script: 'assess-companies.ts', timeoutMin: 45, phase: 'judge', cost: 'llm',
    why: 'accumulative judgment: prior assessment plus what arrived since' },
  { name: 'review', script: 'review-dashboard.ts', timeoutMin: 10, phase: 'publish', cost: 'llm',
    why: 'the set is only checkable once placement has decided what is in it' },
  { name: 'digest', script: 'render-digest.ts', args: ['--save'], timeoutMin: 10, phase: 'publish', cost: 'llm',
    weeklyOnly: true,
    why: 'placement matrix and the rendered digest' },
];
