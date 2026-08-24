/**
 * Singapore value propositions for draft outreach generation.
 *
 * ── SOURCING RULE ────────────────────────────────────────────────────────────
 * Every claim below is drawn from PUBLIC sources: Budget 2026, EDB publications,
 * MAS/MTI/MPA/NRF/A*STAR statements, and reported news. Nothing here comes from
 * internal papers, programme budgets, agency KPI splits or unpublished strategy.
 * Keep it that way — this text goes into emails to external companies, and every
 * claim should be traceable to something the recipient could look up.
 *
 * Figures carry dates because they go stale. Re-verify before any outreach cycle;
 * the tariff position in particular was fluid through 2026.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SCOPE: deep tech, biotech, defence tech, and the AI value chain. AI is treated
 * as a cross-cutting tag rather than a sector — an AI chip company is both.
 *
 * THE CENTRAL RULE: never pitch cost. Singapore is a high-cost location by design
 * and everyone in hardware knows it. The argument is capability, trust, capital,
 * regulatory speed and ecosystem density. Where a company genuinely needs cheap
 * land, power or labour, the honest answer is the Johor twin model or nothing.
 */

export type ValueProp = {
  id: string;
  title: string;
  /**
   * 'established' — real capability, publicly evidenced, describable as available.
   * 'committed'   — publicly announced and funded, but not yet delivered. Describe
   *                 as underway, never as available today.
   * 'exploratory' — a hypothesis being tested. Frame as a question. Never as an offer.
   */
  status: 'established' | 'committed' | 'exploratory';
  sectors: Array<'deeptech' | 'biotech' | 'defence_tech' | 'ai' | 'cross_sector'>;
  description: string;
  evidence: string[];      // public, checkable, with dates
  fits: string[];
  avoidWhen: string[];
  ask: string;
};

export const VALUE_PROPS: ValueProp[] = [
  {
    id: 'semiconductor_ecosystem',
    title: 'Semiconductor and advanced electronics ecosystem',
    status: 'established',
    sectors: ['deeptech', 'ai'],
    description:
      'Singapore sits on a genuinely large share of global semiconductor activity, weighted ' +
      'toward specialty and mature nodes, advanced packaging and equipment rather than ' +
      'leading-edge logic. For a company with silicon in its stack — AI accelerators, power ' +
      'management, sensing, photonics — foundry, packaging and equipment supply chains are ' +
      'present in one jurisdiction, which shortens the loop between design change and ' +
      'qualified part.',
    evidence: [
      'EDB: Singapore accounts for roughly one in ten chips and one in five semiconductor equipment units worldwide',
      'EDB: over S$30bn in semiconductor investment commitments 2022–2025',
      'Micron broke ground January 2026 on a US$24bn advanced NAND fab, first wafers expected H2 2028',
      'Anchors present: GlobalFoundries, Micron, Soitec, Applied Materials, Vanguard International Semiconductor',
    ],
    fits: [
      'custom or semi-custom silicon, AI accelerators, photonics',
      'power management, motor control, sensor front-end content',
      'advanced packaging or chiplet-dependent architecture',
      'facing mature-node allocation or lead-time pressure',
    ],
    avoidWhen: [
      'requires leading-edge logic fabrication',
      'high-volume, low-cost assembly and test — Penang wins this and it is not close',
      'pure software',
    ],
    ask: 'Scope a foundry, packaging or equipment engagement with a named partner.',
  },
  {
    id: 'ai_missions',
    title: 'National AI missions with named sectors and organised demand',
    status: 'committed',
    sectors: ['ai', 'deeptech'],
    description:
      'Singapore has put AI at the centre of its economic strategy with governance at head-of-' +
      'government level and four named sector missions: advanced manufacturing, connectivity ' +
      'and logistics, finance, and healthcare. Each is intended to come with datasets, compute ' +
      'and regulatory sandbox arrangements. For an applied AI company, this means organised ' +
      'demand in defined sectors rather than hunting for individual buyers — and a compact ' +
      'market where a deployment can be run end to end and evidenced properly.',
    evidence: [
      'Budget 2026 (12 Feb 2026): National AI Council chaired by the Prime Minister',
      'Four National AI Missions: advanced manufacturing, connectivity and logistics, finance, healthcare',
      'Over 60 AI Centres of Excellence already established in Singapore',
      'S$1bn public AI research investment across 2025–2030',
    ],
    fits: [
      'applied AI selling into manufacturing, logistics, ports, aviation, finance or health',
      'needs reference deployments outside the US',
      'enterprise or government motion rather than consumer',
      'has announced commercial pilots or first deployments',
    ],
    avoidWhen: [
      'consumer product with no enterprise or public-sector motion',
      'pre-product or research-stage',
      'the use case is narrow enough that no second buyer exists',
    ],
    ask: 'Identify a named operator and a use case with more than one buyer behind it.',
  },
  {
    id: 'compute_constraint_honest',
    title: 'Compute and data centre capacity — with the constraint stated plainly',
    status: 'established',
    sectors: ['ai'],
    description:
      'Singapore has real data centre capacity and unusually strict efficiency requirements, but ' +
      'supply is rationed on power and land, and build costs are among the highest in the world. ' +
      'For an AI company whose need is orchestration, low-latency regional presence, regulated-' +
      'data workloads or a sales and engineering base, Singapore works. For bulk training ' +
      'compute, it does not, and the honest recommendation is the Johor twin model — Singapore ' +
      'for headquarters, engineering and customers, across the border for megawatts. Saying this ' +
      'directly is more credible than not saying it, because the company already knows.',
    evidence: [
      'Green Data Centre Roadmap (May 2024) adds at least 300MW; a further allocation from December 2025 requires at least 50% green power and PUE at or below 1.25',
      'Turner & Townsend 2025 index: Singapore build cost US$14.53/watt, second globally, and the most power-constrained data centre market',
      'Johor–Singapore Special Economic Zone signed 7 January 2025',
    ],
    fits: [
      'needs regional presence, low latency to Southeast Asia, or regulated-data hosting',
      'inference and deployment rather than large-scale training',
      'wants a regional engineering and commercial base near compute, not the compute itself',
    ],
    avoidWhen: [
      'needs more than roughly 5–10MW — route to the Johor conversation instead',
      'the entire proposition is cheap power',
    ],
    ask: 'Separate the workload: what needs to be in Singapore versus across the border.',
  },
  {
    id: 'biomedical_manufacturing',
    title: 'Biopharma and medtech manufacturing with a well-regarded regulator',
    status: 'established',
    sectors: ['biotech'],
    description:
      'Singapore has one of Asia\'s deepest biopharmaceutical manufacturing bases, with ' +
      'plug-and-play facilities, established contract manufacturing, and a regulator recognised ' +
      'internationally — which matters because approval here tends to ease subsequent entry ' +
      'across Asian markets. The combination of regulated-product capability and electronics ' +
      'manufacturing in one jurisdiction is unusual, and it is the operative one for diagnostics ' +
      'and devices that cross from wellness into a regulated claim.',
    evidence: [
      'Eight of the top ten global pharmaceutical companies have manufacturing or R&D presence',
      'Over 60 biopharmaceutical manufacturing facilities',
      'AstraZeneca US$1.5bn end-to-end antibody-drug conjugate facility announced for Tuas, operational 2029',
      'HSA is listed by WHO as a top-tier regulatory authority',
    ],
    fits: [
      'therapeutics, diagnostics or devices seeking Asian market entry',
      'has announced clinical trial or regulatory expansion into Asia',
      'biologics, ADCs, cell and gene therapy manufacturing',
      'hardware company moving toward a regulated health claim',
    ],
    avoidWhen: [
      'pre-clinical with no regulatory pathway defined',
      'commodity generics competing on cost',
    ],
    ask: 'Introduce regulatory and manufacturing counterparts; scope an Asia regulatory pathway.',
  },
  {
    id: 'rd_partnership',
    title: 'Public R&D co-funding and research partnership',
    status: 'committed',
    sectors: ['deeptech', 'biotech', 'ai', 'cross_sector'],
    description:
      'Singapore funds applied research at national scale and co-develops with industry on ' +
      'cost-shared terms. The current five-year plan names the sectors it will back, which makes ' +
      'the fit question answerable rather than vague. For a company with a technical roadmap gap ' +
      'and hiring constraints, a research partnership is also a lower-commitment entry point ' +
      'than a facility — and often the thing that leads to one.',
    evidence: [
      'RIE2030: S$37bn over five years from April 2026, a 32% increase on the previous plan',
      'Named sectors include semiconductors (advanced packaging and photonics), biomedical sciences, sustainability technologies, quantum computing, the space economy, robotics and AI',
      'A*STAR institutes host industry consortia and joint labs across manufacturing, materials and biomedical',
    ],
    fits: [
      'research-intensive with a stated technical roadmap gap',
      'has existing university or national-lab partnerships in the US',
      'hiring research engineers faster than it can fill roles',
      'needs a route from lab-scale process to manufacturable product',
    ],
    avoidWhen: [
      'pure commercial scaling with no R&D agenda',
      'the technical area falls outside the named sectors',
    ],
    ask: 'Scope a co-development or joint-lab engagement with a named research counterpart.',
  },
  {
    id: 'capital_and_listing',
    title: 'Growth capital, co-investment and a listing route',
    status: 'committed',
    sectors: ['deeptech', 'biotech', 'ai', 'cross_sector'],
    description:
      'Singapore has publicly shifted from courting large multinationals toward anchoring ' +
      'high-growth companies early, and has put capital behind it — deep-tech growth funding, ' +
      'a listings anchor fund, government-linked venture investment, and a dual-listing bridge ' +
      'with Nasdaq. For a scale-up weighing where its regional entity sits, the capital ' +
      'relationship is often a more compelling reason than the operational one.',
    evidence: [
      'Budget 2026: EDB will step up efforts to attract high-growth companies with potential to become future industry leaders, working with VC and PE partners',
      'S$1bn top-up to Startup SG Equity, scope expanded to growth-stage deep tech',
      'Second S$1.5bn tranche of the Anchor Fund @ Temasek to support SGX listings',
      'SGX–Nasdaq dual-listing bridge',
    ],
    fits: [
      'Series A through C, raising or about to raise',
      'deep tech with long capital requirements',
      'weighing an eventual Asian listing or dual listing',
      'investors already active in Asia',
    ],
    avoidWhen: [
      'the company reads the approach as a solicitation for investment rather than an offer',
      'late-stage with no capital need',
    ],
    ask: 'Introduce the relevant investment counterpart; understand their next round timing.',
  },
  {
    id: 'talent_pathways',
    title: 'Immigration pathways that work for small technical teams',
    status: 'established',
    sectors: ['deeptech', 'biotech', 'ai', 'cross_sector'],
    description:
      'Immigration policy is structurally favourable to small deep-tech teams in a way that is ' +
      'not widely understood — the points framework that governs work passes automatically ' +
      'awards full diversity and local-support credit to firms below roughly 25 professional ' +
      'staff, which is precisely the profile of a Series A company opening its first overseas ' +
      'office. There is also a dedicated route for senior technical and AI talent. This matters ' +
      'more at ten people than at a thousand, and it is often the practical blocker a founder ' +
      'is actually worried about.',
    evidence: [
      'The COMPASS framework awards full diversity and local-support points to firms with 25 or fewer professional staff',
      'ONE Pass for senior talent, with an AI and technology track from January 2027',
      'A shortage occupation list covering ICT, financial services and green economy roles confers bonus points',
    ],
    fits: [
      'small team opening a first overseas office',
      'hiring senior technical or research staff',
      'has cited hiring difficulty publicly',
      'founders considering relocating personally',
    ],
    avoidWhen: [
      'planning large-scale hiring of lower-wage staff — the policy is not designed for this',
    ],
    ask: 'Walk through the practical mechanics for their specific first three hires.',
  },
  {
    id: 'trusted_jurisdiction',
    title: 'Trusted, neutral jurisdiction with clean provenance',
    status: 'established',
    sectors: ['deeptech', 'defence_tech', 'ai', 'cross_sector'],
    description:
      'For companies facing customer or regulatory scrutiny on sourcing and corporate ' +
      'provenance, Singapore offers a neutral, common-law jurisdiction with established export ' +
      'control administration, strong IP protection and a US free trade agreement. The argument ' +
      'is provenance and diversification of a concentrated supply base. It is NOT tariff ' +
      'arbitrage and must never be pitched as a routing arrangement — pressure in this area ' +
      'runs through designation of named companies rather than country of assembly, so ' +
      'relocating shipment does not change a designation. Note also that Singapore\'s position ' +
      'in AI chip flows has itself drawn export-control attention, which is a compliance ' +
      'consideration worth raising honestly with chip-adjacent companies rather than avoiding.',
    evidence: [
      'US–Singapore Free Trade Agreement in force since 2004',
      'Ranked first of 70 economies in the IMD World Competitiveness Ranking, June 2026',
      'Extensive FTA network including CPTPP, RCEP and EU–Singapore, plus Digital Economy Agreements',
    ],
    fits: [
      'sells into defence, aerospace, critical infrastructure or government',
      'has publicly discussed supply chain concentration or provenance',
      'export-controlled or subject to customer sourcing restrictions',
    ],
    avoidWhen: [
      'US defence-tech whose core work is ITAR or EAR controlled — offshore engineering may be ' +
        'legally constrained regardless of appetite, so check before investing effort',
      'the company\'s own ownership or capital sources undercut the provenance claim',
      'the company is seeking a transshipment or country-of-origin workaround',
    ],
    ask: 'Establish what activity could genuinely sit here given their control regime.',
  },
  {
    id: 'regional_base',
    title: 'Regional base for Asia — with real functions, not just an entity',
    status: 'established',
    sectors: ['cross_sector'],
    description:
      'Singapore is the standard base from which US companies run Southeast Asia: common-law ' +
      'jurisdiction, English-language business environment, strong IP protection, and regional ' +
      'decision-makers and supply chain counterparts within short reach. The caveat matters ' +
      'internally: a sales office alone is not the outcome being sought, and the pattern of ' +
      'companies taking a regional headquarters while keeping product development at home is ' +
      'well established. Aim the conversation at which functions actually move.',
    evidence: [
      'EDB 2025 results (announced February 2026): S$14.2bn fixed asset investment and S$8.9bn total business expenditure commitments',
      'Ranked first of 70 economies in the IMD World Competitiveness Ranking, June 2026',
    ],
    fits: [
      'appointed or hiring a VP International, Head of APAC or GM Asia',
      'posting roles in Asia or citing international expansion',
      'has Asian customers, suppliers or partners but no regional entity',
      'post-Series B with a US-only footprint',
    ],
    avoidWhen: [
      'already has substantial Singapore or APAC presence',
      'structurally US-only business',
      'the realistic outcome is a sales entity with no engineering substance',
    ],
    ask: 'Establish which functions would sit here — engineering or operations, not sales alone.',
  },
  {
    id: 'quantum',
    title: 'Quantum computing and sensing',
    status: 'committed',
    sectors: ['deeptech'],
    description:
      'Quantum is a named national priority with a dedicated strategy, a national office, and ' +
      'operating hardware on the ground. The community is small, which cuts both ways: limited ' +
      'talent depth, but unusually easy access to the people who matter and to national ' +
      'programme decision-makers.',
    evidence: [
      'National Quantum Strategy announced 2024 with a national quantum office and computing hub',
      'Quantinuum bringing its Helios system plus an R&D and operations centre in 2026',
      'Quantum named as a pillar in the RIE2030 plan',
    ],
    fits: [
      'quantum computing, sensing, networking or enabling components',
      'needs access to a national programme rather than a single customer',
      'looking for research collaboration and early-adopter users',
    ],
    avoidWhen: [
      'needs a large existing quantum talent pool — the base is small',
    ],
    ask: 'Introduce national programme counterparts; scope a research or deployment engagement.',
  },
];

/** Compact form injected into the drafting prompt. */
export function valuePropsForPrompt(sectors?: string[]): string {
  const props = sectors?.length
    ? VALUE_PROPS.filter(
        (v) => v.sectors.some((s) => sectors.includes(s)) || v.sectors.includes('cross_sector')
      )
    : VALUE_PROPS;

  return props
    .map(
      (v) =>
        `[${v.id}] (${v.status.toUpperCase()}) ${v.title}\n` +
        `${v.description}\n` +
        `Public evidence: ${v.evidence.join(' | ')}\n` +
        `Fits: ${v.fits.join('; ')}\n` +
        `Avoid when: ${v.avoidWhen.join('; ')}\n` +
        `Goal: ${v.ask}`
    )
    .join('\n\n');
}

export const DRAFTING_GUARDRAILS = `
- Pick ONE value proposition. An email listing several reads as a brochure.
- If the prop is EXPLORATORY, write it as a question, never an offer. If it is COMMITTED,
  describe it as underway, not as available today.
- Reference the specific trigger event. If the pitch cannot be tied to something that just
  happened at this company, the draft is not ready.
- Use at most one piece of public evidence, and only if it is directly relevant. Numbers in
  a cold email read as a brochure. Never cite a figure you cannot date.
- Never name grant schemes, incentive quantums or programme budgets.
- Do not claim capability Singapore lacks. If the need falls under an avoidWhen, say so in
  the rationale and pick another angle, or return no draft.
- NEVER pitch cost. Singapore is expensive and the recipient knows it. Where the need is
  genuinely cheap land, power or labour, the honest move is the Johor twin model.
- Never suggest transshipment, routing or country-of-origin arrangements in any framing.
- Aim at real activity — engineering, pilot production, deployment, research. Not a
  holding entity.
- Under 150 words. A regional director will edit before sending; make that easy.
`;
