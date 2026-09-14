/**
 * Seed fund list for portfolio scraping.
 *
 * Reading the fields:
 * - `tier: 'mega'` funds are high-volume, low-signal: they enrich the graph but
 *   their edges get the hub-node degree discount. `tier: 'specialist'` funds are
 *   where discovery value lives — a new name on Lux's page means more than a new
 *   name on a16z's.
 * - `sgLinked: true` funds matter doubly: membership in their portfolio is itself
 *   an sg_link and a warm-path input, not just an investment edge.
 * - portfolioUrl values are best-effort and these sites restructure often, so
 *   each one is worth re-checking at build time. The scraper treats a 404 or an
 *   empty parse as a source-health event rather than a silent skip.
 * - `scrape: false` marks the sites whose robots.txt or ToS prohibits it, plus
 *   the ones that block automated requests; those get quarterly manual updates.
 * - Around 70% are scrapable as clean HTML lists. JS-rendered pages fall back to
 *   a manual snapshot.
 */

export type Fund = {
  name: string;
  aliases: string[];
  tier: 'mega' | 'specialist';
  sectors: Array<'deeptech' | 'biotech' | 'defence_tech' | 'ai' | 'generalist'>;
  portfolioUrl: string;
  sgLinked?: boolean;
  scrape: boolean;
  notes?: string;
};

export const FUNDS: Fund[] = [
  // ── Mega / generalist (graph enrichment; heavy hub discount) ──────────────
  { name: 'Andreessen Horowitz', aliases: ['a16z', 'AH Capital Management'], tier: 'mega',
    sectors: ['generalist', 'ai', 'defence_tech', 'biotech'],
    portfolioUrl: 'https://a16z.com/portfolio/', scrape: true,
    notes: 'American Dynamism practice covers defence; a16z Bio covers biotech. One org node, not three.' },
  { name: 'Sequoia Capital', aliases: ['Sequoia'], tier: 'mega', sectors: ['generalist', 'ai'],
    portfolioUrl: 'https://sequoiacap.com/our-companies', scrape: true },
  { name: 'Lightspeed Venture Partners', aliases: ['Lightspeed', 'LSVP'], tier: 'mega',
    sectors: ['generalist', 'ai'], portfolioUrl: 'https://lsvp.com/companies/', scrape: true },
  { name: 'General Catalyst', aliases: ['GC'], tier: 'mega', sectors: ['generalist', 'ai', 'defence_tech'],
    portfolioUrl: 'https://www.generalcatalyst.com/portfolio', scrape: true },
  { name: 'Khosla Ventures', aliases: ['Khosla'], tier: 'mega',
    sectors: ['generalist', 'deeptech', 'biotech', 'ai'],
    portfolioUrl: 'https://www.khoslaventures.com/portfolio/', scrape: true },
  { name: 'Founders Fund', aliases: ['FF'], tier: 'mega', sectors: ['generalist', 'defence_tech', 'deeptech'],
    portfolioUrl: 'https://foundersfund.com/portfolio/', scrape: true,
    notes: 'Highest defence relevance among the mega funds.' },
  { name: 'Index Ventures', aliases: ['Index'], tier: 'mega', sectors: ['generalist', 'ai'],
    portfolioUrl: 'https://www.indexventures.com/companies/', scrape: true },
  { name: 'Bessemer Venture Partners', aliases: ['Bessemer', 'BVP'], tier: 'mega',
    sectors: ['generalist', 'ai', 'biotech'],
    portfolioUrl: 'https://www.bvp.com/companies', scrape: true },

  // ── Deeptech specialists (primary discovery lane) ─────────────────────────
  { name: 'Lux Capital', aliases: ['Lux'], tier: 'specialist',
    sectors: ['deeptech', 'defence_tech', 'biotech'],
    portfolioUrl: 'https://www.luxcapital.com/companies', scrape: true },
  { name: 'DCVC', aliases: ['Data Collective'], tier: 'specialist', sectors: ['deeptech', 'biotech'],
    portfolioUrl: 'https://www.dcvc.com/companies/', scrape: true },
  { name: 'Eclipse Ventures', aliases: ['Eclipse'], tier: 'specialist', sectors: ['deeptech'],
    portfolioUrl: 'https://eclipse.capital/portfolio/', scrape: true,
    notes: 'Physical-industry focus: manufacturing, logistics, hardware.' },
  { name: 'Playground Global', aliases: ['Playground'], tier: 'specialist', sectors: ['deeptech'],
    portfolioUrl: 'https://www.playground.vc/portfolio', scrape: true },
  { name: '8VC', aliases: [], tier: 'specialist', sectors: ['deeptech', 'defence_tech', 'biotech'],
    portfolioUrl: 'https://www.8vc.com/companies', scrape: true },
  { name: 'The Engine', aliases: ['The Engine Ventures'], tier: 'specialist', sectors: ['deeptech'],
    portfolioUrl: 'https://www.engine.xyz/companies', scrape: true,
    notes: 'MIT tough-tech; Boston-weighted, keep for graph completeness.' },
  { name: 'Prime Movers Lab', aliases: [], tier: 'specialist', sectors: ['deeptech'],
    portfolioUrl: 'https://www.primemoverslab.com/portfolio', scrape: true },
  { name: 'Root Ventures', aliases: ['Root'], tier: 'specialist', sectors: ['deeptech'],
    portfolioUrl: 'https://root.vc/', scrape: true,
    notes: 'Portfolio listed on homepage; hard-tech seed.' },

  // ── Defence / dual-use ────────────────────────────────────────────────────
  { name: 'Shield Capital', aliases: ['Shield'], tier: 'specialist', sectors: ['defence_tech'],
    portfolioUrl: 'https://shieldcap.com/portfolio/', scrape: true },
  { name: 'Razor\'s Edge Ventures', aliases: ['Razors Edge'], tier: 'specialist', sectors: ['defence_tech'],
    portfolioUrl: 'https://www.razorsedgeventures.com/portfolio', scrape: false,
    notes: 'DNS/connection failure on both .com variants, so scrape:false.' },
  { name: 'In-Q-Tel', aliases: ['IQT'], tier: 'specialist', sectors: ['defence_tech', 'deeptech'],
    portfolioUrl: 'https://www.iqt.org/portfolio/', scrape: true,
    notes: 'US intelligence-community strategic investor. An IQT edge is a strong ITAR/EAR flag: check export-control exposure before any outreach effort.' },

  // ── Bio specialists ───────────────────────────────────────────────────────
  { name: 'ARCH Venture Partners', aliases: ['ARCH'], tier: 'specialist', sectors: ['biotech'],
    portfolioUrl: 'https://www.archventure.com/portfolio/', scrape: true },
  { name: 'Flagship Pioneering', aliases: ['Flagship'], tier: 'specialist', sectors: ['biotech'],
    portfolioUrl: 'https://www.flagshippioneering.com/companies', scrape: true,
    notes: 'Company-creation model — new names here are very early.' },
  { name: 'Third Rock Ventures', aliases: ['Third Rock'], tier: 'specialist', sectors: ['biotech'],
    portfolioUrl: 'https://www.thirdrockventures.com/portfolio', scrape: true },
  { name: 'Dimension Capital', aliases: ['Dimension'], tier: 'specialist', sectors: ['biotech', 'ai'],
    portfolioUrl: 'https://www.dimensioncap.com/portfolio', scrape: true,
    notes: 'Bio × software intersection — matches the AI-in-bio slice of scope.' },

  // ── AI specialists ────────────────────────────────────────────────────────
  { name: 'Conviction', aliases: ['Conviction Partners'], tier: 'specialist', sectors: ['ai'],
    portfolioUrl: 'https://www.conviction.com/companies', scrape: false,
    notes: '404, and no portfolio path found from the homepage. scrape:false until a working URL is confirmed.' },
  { name: 'Basis Set Ventures', aliases: ['Basis Set'], tier: 'specialist', sectors: ['ai'],
    portfolioUrl: 'https://www.basisset.com/portfolio', scrape: true },
  { name: 'Radical Ventures', aliases: ['Radical'], tier: 'specialist', sectors: ['ai'],
    portfolioUrl: 'https://radical.vc/portfolio/', scrape: true },
  { name: 'AIX Ventures', aliases: ['AIX'], tier: 'specialist', sectors: ['ai'],
    portfolioUrl: 'https://www.aixventures.com/', scrape: true },
  { name: 'Amplify Partners', aliases: ['Amplify'], tier: 'specialist', sectors: ['ai', 'deeptech'],
    portfolioUrl: 'https://www.amplifypartners.com/portfolio/company', scrape: true,
    notes: 'Infra and developer-tools weighting — the AI value-chain middle layer.' },
  { name: 'Felicis', aliases: ['Felicis Ventures'], tier: 'specialist', sectors: ['ai', 'generalist'],
    portfolioUrl: 'https://www.felicis.com/portfolio', scrape: true },

  // ── Singapore-linked (portfolio membership feeds sg_links directly) ───────
  { name: 'EDBI', aliases: [], tier: 'specialist', sectors: ['generalist', 'deeptech', 'biotech'],
    portfolioUrl: 'https://www.edbi.com/portfolio', sgLinked: true, scrape: false,
    notes: 'EDB\'s own investment arm, and the warmest sg_link available: a US company in this portfolio already has a Singapore relationship. Populate first. All paths return 403 to automated requests, so scrape:false and it needs a manual quarterly snapshot.' },
  { name: 'Vertex Ventures US', aliases: ['Vertex US', 'Vertex Ventures'], tier: 'specialist',
    sectors: ['ai', 'deeptech'], portfolioUrl: 'https://vvus.com/portfolio/', sgLinked: true, scrape: true,
    notes: 'Temasek-anchored Vertex family. URL especially uncertain — verify.' },
  { name: 'Granite Asia', aliases: ['GGV Capital'], tier: 'specialist', sectors: ['generalist', 'ai'],
    portfolioUrl: 'https://www.graniteasia.com/', sgLinked: true, scrape: true,
    notes: 'Successor to GGV\'s Asia business, Singapore-based. Keep the GGV alias — older filings and news use it.' },
  { name: 'B Capital', aliases: ['B Capital Group'], tier: 'specialist', sectors: ['generalist', 'ai', 'biotech'],
    portfolioUrl: 'https://b.capital/portfolio/', sgLinked: true, scrape: true,
    notes: 'US–Asia crossover fund with Singapore presence.' },

  // ── Singapore state investors ─────────────────────────────────────────────
  // The strongest Singapore signals in the system. They are listed as
  // first-class organizations carrying sgPresence, which is what drives the
  // warm-path base score; as bare sg_apac tokens from the seed CSV their graph
  // degree comes out misleadingly small (see lib/paths.ts degreeCoverage).
  //
  // Neither is scrapable. They are sovereign funds rather than VCs and publish
  // no company-level portfolio list: gic.com.sg/portfolio returns 200 with only
  // navigation on it, and temasek.com.sg returns 403 from Cloudflare.
  { name: 'GIC', aliases: ['GIC Private Limited', 'Government of Singapore Investment Corporation'],
    tier: 'mega', sectors: ['generalist', 'ai', 'deeptech', 'biotech'],
    portfolioUrl: 'https://www.gic.com.sg/portfolio/', sgLinked: true, scrape: false,
    notes: 'Singapore sovereign wealth fund. The site carries no company-level portfolio page, only nav, so edges arrive from seed research and news. A GIC edge is a genuine Singapore relationship.' },
  { name: 'Temasek', aliases: ['Temasek Holdings', 'Temasek International'],
    tier: 'mega', sectors: ['generalist', 'ai', 'deeptech', 'biotech'],
    portfolioUrl: 'https://www.temasek.com.sg/en/our-portfolio/our-investments', sgLinked: true, scrape: false,
    notes: 'Singapore state investor. The site returns 403 to automated requests, so edges arrive from seed research and news. Among the warmest sg_links available.' },
];
