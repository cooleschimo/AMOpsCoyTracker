/**
 * The sector taxonomy. Brief §2.
 *
 * The four original sectors — deeptech, biotech, defence_tech, ai — grouped
 * companies by what they talk about. These group them by what they would need
 * from Singapore, which is the question every axis in the rubric turns on.
 *
 * The distinction is not cosmetic. A GPU cloud operator and a legal-AI SaaS
 * firm were both tagged 'ai' and nothing else, yet one needs power, land, and a
 * data-centre siting decision that takes years, and the other needs an office
 * and a sales team. The old tag could not tell them apart, so the expansion
 * axis had nothing to work with; these can.
 *
 * One primary subsector per company, chosen by what it sells rather than what
 * it uses. A drug company that discovers molecules with a transformer is a
 * drug company — nearly everything here uses AI now, and a tag that catches
 * everything separates nothing. `broad` carries the rollup, while `tags`
 * carries the secondary reading.
 */

/** `short` is the tag a reader scans; `label` is the definition a classifier reads. */
export const BROAD_SECTOR_DEFS = [
  {
    id: 'ai',
    short: 'AI',
    label: 'AI products and infrastructure',
    includes: 'AI product companies, model labs, AI application software and AI compute infrastructure',
  },
  {
    id: 'compute',
    short: 'Compute',
    label: 'Advanced compute and enabling hardware',
    includes: 'semiconductors, photonics and quantum systems',
  },
  {
    id: 'industrial',
    short: 'Industrial',
    label: 'Industrial and physical systems',
    includes: 'robotics, advanced manufacturing, materials, batteries and energy systems',
  },
  {
    id: 'aerospace',
    short: 'Aerospace',
    label: 'Aerospace and space',
    includes: 'space systems, launch, satellites and related infrastructure',
  },
  {
    id: 'defence',
    short: 'Defence',
    label: 'Defence and national security',
    includes: 'defence hardware, autonomous defence systems and national-security software',
  },
  {
    id: 'health',
    short: 'Health',
    label: 'Life sciences and health',
    includes: 'therapeutics, biotech tools, medical devices, digital health and care services',
  },
  {
    id: 'digital',
    short: 'Digital',
    label: 'Digital infrastructure and software',
    includes: 'general software platforms, cybersecurity and networking/connectivity',
  },
  {
    id: 'commerce',
    short: 'Commerce',
    label: 'Commerce and logistics',
    includes: 'marketplaces, distribution, commerce enablement and supply-chain operations',
  },
  {
    id: 'finance',
    short: 'Finance',
    label: 'Finance and real assets',
    includes: 'fintech, financial services, investment funds and real estate vehicles',
  },
  {
    id: 'other',
    short: 'Other',
    label: 'Other',
    includes: 'companies that do not fit the defined broad sectors',
  },
] as const;

export type BroadSectorId = (typeof BROAD_SECTOR_DEFS)[number]['id'];

export type SectorDef = {
  id: string;
  broad: BroadSectorId;
  label: string;
  /** One or two words. What goes on a tag, where the full label will not fit. */
  short: string;
  /** What a company here would need from Singapore. */
  needs: string;
  /** Named so a classifier and a reader draw the same line. */
  includes: string;
  excludes?: string;
  /**
   * What this subsector's news is written about when a company there does
   * something an agency would want to know about. Read by lib/news-sources.ts
   * to build the sector queries, so the words sit beside the definition they
   * belong to rather than in a query string somewhere else.
   *
   * What counts as significant differs by subsector, and the terms follow
   * `needs` rather than a single template. A semiconductor company's moment is
   * a fab; an AI software company's is a regional office and a first enterprise
   * customer; a fintech's is a licence. None of those look alike in a headline,
   * and asking all three for "breaks ground" would find only the first.
   */
  searchTerms?: string[];
};

export const SECTOR_DEFS: SectorDef[] = [
  // ---- compute and semiconductors ------------------------------------------
  {
    id: 'semiconductors',
    short: 'Semiconductors',
    broad: 'compute',
    label: 'Semiconductors and chip design',
    needs: 'fab access, packaging capacity, IP protection, process engineers',
    includes: 'AI accelerators and inference ASICs, CPUs and processor IP, chiplets, analog and in-memory compute, RISC-V silicon',
    excludes: 'photonic interconnect, which is photonics',
    searchTerms: ['"new fab"', '"chip plant"', '"advanced packaging"', '"wafer fab"'],
  },
  {
    id: 'photonics',
    short: 'Photonics',
    broad: 'compute',
    label: 'Photonics and optical interconnect',
    needs: 'advanced packaging, optics fabrication, precision assembly',
    includes: 'optical I/O and chiplets, silicon photonics, beam steering, optical networking components, DSPs for optical links',
    searchTerms: ['"photonics fab"', '"optical interconnect"', '"silicon photonics" facility'],
  },
  {
    id: 'quantum',
    short: 'Quantum',
    broad: 'compute',
    label: 'Quantum computing and sensing',
    needs: 'research partners, national programme demand, specialist talent',
    includes: 'quantum computers of any modality, quantum sensing, post-quantum security where it is the main product',
    searchTerms: ['"quantum computing" facility', 'quantum "national programme"', '"quantum research centre"'],
  },
  {
    id: 'ai_infrastructure',
    short: 'AI compute',
    broad: 'ai',
    label: 'AI compute infrastructure',
    needs: 'power, land, grid connection, data-centre siting, cooling',
    includes: 'GPU clouds, AI data centres, inference-serving platforms sold as capacity',
    excludes: 'chip designers, which are semiconductors',
    searchTerms: ['"data centre" gigawatt', '"data center" "breaks ground"', '"AI campus"'],
  },
  {
    id: 'ai_models',
    short: 'Models',
    broad: 'ai',
    label: 'Foundation models and research labs',
    needs: 'compute, research talent, data agreements, government relationships',
    includes: 'frontier and open model labs, multimodal generation models, robot and protein foundation models',
    searchTerms: [
      '"foundation model" ("compute deal" OR "training cluster" OR "sovereign AI") -"market size"',
      '"AI lab" ("government partnership" OR "national programme") Asia',
    ],
  },
  {
    id: 'ai_software',
    short: 'AI software',
    broad: 'ai',
    label: 'AI applications and developer tools',
    needs: 'office space, sales and support staff, enterprise reference customers',
    includes: 'vertical AI SaaS (legal, healthcare, support), coding assistants, enterprise search, agent orchestration, evaluation and observability, data platforms',
    excludes: 'anything whose product is compute or a model rather than software over one',
    searchTerms: [
      '("AI startup" OR "AI platform") ("opens office" OR "expands into" OR "first customer") -"market size"',
      '"enterprise AI" deployment (Singapore OR Asia) -"market size" -forecast',
    ],
  },

  // ---- robotics and physical systems ---------------------------------------
  {
    id: 'robotics',
    short: 'Robotics',
    broad: 'industrial',
    label: 'Robotics and autonomous systems',
    needs: 'manufacturing space, field trial sites, systems and controls engineers',
    includes: 'warehouse and logistics robots, humanoids, industrial arms, field robotics, self-driving vehicles, delivery robots and drones for civil use',
    excludes: 'surgical robots, which are medical devices; armed or ISR drones, which are defence',
    searchTerms: ['robotics "production facility"', '"automated factory"', '"robot manufacturing"'],
  },
  {
    id: 'space',
    short: 'Space',
    broad: 'aerospace',
    label: 'Space systems',
    needs: 'launch access, ground stations, spectrum, export-control clearance',
    includes: 'satellites and buses, earth observation, in-space manufacturing, launch and reentry',
    searchTerms: ['"satellite manufacturing"', '"launch facility"', 'space "production facility"'],
  },
  {
    id: 'advanced_manufacturing',
    short: 'Manufacturing',
    broad: 'industrial',
    label: 'Advanced manufacturing and industrial technology',
    needs: 'industrial land, plant capacity, skilled production workforce',
    includes: 'automated factories and machining, additive manufacturing as a product, industrial process technology',
    searchTerms: ['"advanced manufacturing" plant', '"additive manufacturing" facility'],
  },
  {
    id: 'materials_energy',
    short: 'Materials',
    broad: 'industrial',
    label: 'Advanced materials, batteries and energy',
    needs: 'pilot plant, industrial land, utilities, offtake agreements',
    includes: 'battery materials and cells, graphene and novel materials, energy storage, clean energy generation, climate and recycling technology',
    searchTerms: ['gigafactory', '"cathode plant"', '"battery plant" investment', '"energy storage" facility'],
  },

  // ---- defence -------------------------------------------------------------
  {
    id: 'defence_systems',
    short: 'Defence systems',
    broad: 'defence',
    label: 'Defence systems and hardware',
    needs: 'export-control clearance, government customer, secure facilities',
    includes: 'weapons and munitions, military drones and counter-UAS, radar and electronic warfare, defence manufacturing',
    excludes: 'dual-use autonomy sold mainly to commercial buyers, which is robotics',
    searchTerms: ['"defence manufacturing"', '"defense production facility"', '"munitions plant"'],
  },
  {
    id: 'defence_software',
    short: 'Defence software',
    broad: 'defence',
    label: 'Defence and national-security software',
    needs: 'security clearance, government relationships, secure hosting',
    includes: 'command and control, intelligence and ISR analysis, mission autonomy software, national-security data platforms',
    searchTerms: [
      '"defence software" ("contract award" OR "selected by") -"market size"',
      '"mission autonomy" ("contract" OR "selected by")',
    ],
  },

  // ---- life sciences -------------------------------------------------------
  {
    id: 'therapeutics',
    short: 'Therapeutics',
    broad: 'health',
    label: 'Therapeutics and drug development',
    needs: 'clinical trial sites, regulatory pathway, manufacturing capacity, research partners',
    includes: 'small molecules, biologics and antibodies, gene and cell therapy, gene editing, computational drug discovery where the product is the drug',
    searchTerms: ['biomanufacturing', '"drug substance" facility', '"fill-finish"', '"biologics facility"'],
  },
  {
    id: 'biotech_platforms',
    short: 'Biotech tools',
    broad: 'health',
    label: 'Biotech platforms and tools',
    needs: 'lab space, research partners, instrument manufacturing',
    includes: 'research instruments and reagents, synthetic biology platforms, sequencing and omics tools, bioprocessing technology',
    excludes: 'companies developing their own drug, which are therapeutics',
    searchTerms: ['"bioprocessing" facility', '"research campus" biotech'],
  },
  {
    id: 'medtech_devices',
    short: 'Medical devices',
    broad: 'health',
    label: 'Medical devices and diagnostics',
    needs: 'regulatory approval, clinical partners, device manufacturing',
    includes: 'surgical robots, diagnostics and screening, imaging, implants and neural interfaces, wearable therapeutics',
    searchTerms: ['"medical device" manufacturing facility'],
  },
  {
    id: 'digital_health',
    short: 'Digital health',
    broad: 'health',
    label: 'Digital health and care delivery',
    needs: 'health system partners, clinical data agreements, local operations',
    includes: 'care delivery services, clinical workflow software, health data platforms',
    excludes: 'AI agents sold as software to any industry, which are ai_software',
    searchTerms: [
      '"digital health" ("health system" OR "hospital partnership" OR "regulatory clearance") -"market size"',
    ],
  },

  // ---- other ---------------------------------------------------------------
  {
    id: 'fintech',
    short: 'Fintech',
    broad: 'finance',
    label: 'Financial technology',
    needs: 'regulatory licensing, banking partners, local entity',
    includes: 'payments, banking infrastructure, insurance and capital markets technology',
    searchTerms: [
      'fintech expansion (Singapore OR Asia) -"market size" -forecast',
      'fintech ("payments licence" OR "banking partnership" OR "regulatory approval") -"market size"',
    ],
  },
  {
    id: 'software_platforms',
    short: 'Software',
    broad: 'digital',
    label: 'General software platforms',
    needs: 'office space, engineering talent, sales and support staff',
    includes: 'non-AI SaaS, productivity and collaboration tools, design software, databases, data platforms, developer tools, community platforms',
    excludes: 'AI-first software, which is ai_software; security software, which is cybersecurity',
    searchTerms: [
      '("software company" OR SaaS) ("opens office" OR "regional headquarters") Asia -"market size"',
    ],
  },
  {
    id: 'cybersecurity',
    short: 'Cybersecurity',
    broad: 'digital',
    label: 'Cybersecurity and trust infrastructure',
    needs: 'security talent, enterprise reference customers, regulated-sector buyers',
    includes: 'identity and permissions infrastructure, attack-surface management, software supply-chain security, secure infrastructure tooling',
    searchTerms: [
      'cybersecurity company ("opens" OR "expands" OR "wins contract") -"market size" -report',
    ],
  },
  {
    id: 'networking_connectivity',
    short: 'Networking',
    broad: 'digital',
    label: 'Networking and connectivity',
    needs: 'datacentre and telco partners, enterprise buyers, systems engineers',
    includes: 'cloud networking, routing and switching software, spectrum-management software, telecom network infrastructure',
    searchTerms: [
      '("subsea cable" OR "network expansion" OR "points of presence") investment -"market size"',
    ],
  },
  {
    id: 'commerce_marketplaces',
    short: 'Marketplaces',
    broad: 'commerce',
    label: 'Commerce, marketplaces and distribution',
    needs: 'merchant networks, regional operations, logistics partners',
    includes: 'retail and wholesale marketplaces, distribution platforms, commerce enablement and non-financial transaction platforms',
  },
  {
    id: 'logistics_supply_chain',
    short: 'Logistics',
    broad: 'commerce',
    label: 'Logistics and supply chain',
    needs: 'operations sites, carrier partners, regulated logistics approvals',
    includes: 'cold-chain systems, shipping technology, supply-chain operations platforms, logistics infrastructure',
  },
  {
    id: 'healthcare_services',
    short: 'Care services',
    broad: 'health',
    label: 'Healthcare services',
    needs: 'clinical partnerships, healthcare licensing, local operations',
    includes: 'clinics, outpatient care, care delivery operations, laboratory services without a proprietary device',
    excludes: 'regulated devices and diagnostics, which are medtech_devices; care software, which is digital_health',
  },
  {
    id: 'financial_services',
    short: 'Financial services',
    broad: 'finance',
    label: 'Financial and insurance services',
    needs: 'regulatory licensing, local entity, banking and insurance partners',
    includes: 'asset management, credit products, banking services, insurance services and title insurance that are not primarily technology products',
    excludes: 'technology sold to financial institutions, which is fintech',
  },
  {
    id: 'investment_funds',
    short: 'Funds',
    broad: 'finance',
    label: 'Investment funds and holding vehicles',
    needs: 'fund registration, LP relationships, financial regulatory review',
    includes: 'pooled investment funds, venture funds, feeder funds, SPVs, credit funds and holding vehicles',
  },
  {
    id: 'real_estate',
    short: 'Real estate',
    broad: 'finance',
    label: 'Real estate and property vehicles',
    needs: 'land, property approvals, local partners, financing',
    includes: 'commercial real estate, REITs, property funds, hotel and lodging assets, residential and industrial property vehicles',
  },
];

export const SECTORS = SECTOR_DEFS.map((s) => s.id) as readonly string[];
export const BROAD_SECTORS = BROAD_SECTOR_DEFS.map((s) => s.id) as readonly string[];
export type SectorId = (typeof SECTOR_DEFS)[number]['id'];

const BROAD_BY_ID = new Map(BROAD_SECTOR_DEFS.map((s) => [s.id, s]));
const BY_ID = new Map(SECTOR_DEFS.map((s) => [s.id, s]));
export const broadSectorLabel = (id: string) => BROAD_BY_ID.get(id as BroadSectorId)?.label ?? id;
export const sectorLabel = (id: string) => BY_ID.get(id)?.label ?? id;

/** The tag form: one or two words. Falls back to the id read as words. */
export const sectorShort = (id: string) =>
  BY_ID.get(id)?.short ?? BROAD_BY_ID.get(id as BroadSectorId)?.short ?? id.replace(/_/g, ' ');
export const isSector = (id: string) => BY_ID.has(id);
export const isBroadSector = (id: string): id is BroadSectorId => BROAD_BY_ID.has(id as BroadSectorId);
export const sectorBroadSector = (id: string): BroadSectorId | undefined => BY_ID.get(id)?.broad;
export const subsectorsForBroadSector = (id: BroadSectorId): SectorDef[] =>
  SECTOR_DEFS.filter((s) => s.broad === id);

/**
 * Sectors whose products routinely fall under export control. The digest flags
 * these so an RD checks before making an approach — §7 requires the warning to
 * travel with the company, not with the item.
 */
export const EXPORT_CONTROLLED: string[] = [
  'defence_systems', 'defence_software', 'space', 'quantum', 'semiconductors',
];

/**
 * Subsectors worth searching for more of.
 *
 * Not every subsector in the taxonomy is one EDB is looking for. Finance, real
 * estate, healthcare services, commerce and logistics exist here to CLASSIFY
 * what discovery drags in — a wire feed carries REITs and insurers alongside
 * chipmakers, and a company needs a home even when the answer is "not for us".
 * Searching for more of them would spend the daily allowance widening a part of
 * the graph nobody reads.
 *
 * A subsector earns a query by being one an RD would want more of.
 */
export const SEARCHABLE_SUBSECTORS = SECTOR_DEFS.filter((s) => (s.searchTerms?.length ?? 0) > 0);

/**
 * Subsectors that classify but never surface.
 *
 * The same six, read the other way round. Not searching for funds and REITs
 * kept us from seeking them; it did nothing about the ones discovery brought in
 * anyway, and Andreessen Horowitz reached the dashboard as a company with an
 * office opening. A venture fund is not an investment prospect for EDB — it is
 * the other side of the table.
 *
 * Derived from the same `searchTerms` marker rather than listed again, so the
 * two answers cannot drift: a subsector gains a query and leaves this set in
 * one edit.
 */
/**
 * The four sectors lib/valueprops.ts is written against.
 *
 * Not the old taxonomy resurrected. The value propositions are a SEPARATE axis
 * — what Singapore can offer — and they are written in four families because
 * that is how the offer actually divides: a semiconductor argument covers chips,
 * robotics and launch alike. Mapping them onto twenty-six subsectors would be
 * twenty-six copies of four arguments.
 *
 * `cross_sector` is not produced here; it is a property of a prop, not of a
 * company.
 */
export type ValuePropSector = 'deeptech' | 'biotech' | 'defence_tech' | 'ai';

/**
 * A company's sectors, as lib/valueprops.ts names them.
 *
 * Lives here, beside the taxonomy, because it is the taxonomy that moves: a new
 * broad sector has to gain a line in this switch or its companies silently fall
 * through to the cross-sector props and get the generic offer. That failure is
 * invisible — the digest still renders, with a blander proposition — which is
 * why the mapping is one exported function rather than a test repeated at each
 * call site.
 *
 * `commerce`, `finance` and `other` map to nothing on purpose. There is no
 * Singapore deep-tech argument for a marketplace or a REIT, and inventing one
 * would put a semiconductor pitch in front of a logistics company.
 */
export function valuePropSectors(sectors: readonly string[]): ValuePropSector[] {
  const out = new Set<ValuePropSector>();
  for (const s of sectors) {
    const broad = sectorBroadSector(s) ?? (isBroadSector(s) ? s : undefined);
    switch (broad) {
      case 'ai':
      case 'digital':
        out.add('ai');
        break;
      case 'compute':
      case 'industrial':
      case 'aerospace':
        out.add('deeptech');
        break;
      case 'health':
        out.add('biotech');
        break;
      case 'defence':
        out.add('defence_tech');
        break;
      default:
        break;
    }
    // A row that never got retagged still carries the legacy tag itself, and it
    // is already in this vocabulary. Read it rather than dropping it.
    if (s === 'deeptech' || s === 'biotech' || s === 'defence_tech') out.add(s);
  }
  return [...out];
}

export const UNSURFACED_SUBSECTORS: ReadonlySet<string> = new Set(
  SECTOR_DEFS.filter((s) => !(s.searchTerms?.length ?? 0)).map((s) => s.id),
);

/**
 * Whether a company belongs on the dashboard at all.
 *
 * A company with any surfaceable subsector stays: the tags are a list, and a
 * chipmaker that also carries `investment_funds` for its venture arm is still a
 * chipmaker. Only a company whose every tag is unsurfaceable drops out.
 *
 * An untagged company is kept. Missing tags mean the classifier has not run,
 * which is not the same as a judgement that it does not belong.
 */
export function isSurfaceable(sectors: readonly string[] | null | undefined): boolean {
  if (!sectors?.length) return true;
  return sectors.some((s) => !UNSURFACED_SUBSECTORS.has(s));
}

/** Rendered into the classifier prompt so the model draws our lines, not its own. */
export function sectorsForPrompt(): string {
  return BROAD_SECTOR_DEFS.map((b) => {
    const sectors = subsectorsForBroadSector(b.id);
    return [
      `${b.id}: ${b.label}. ${b.includes}. Use with an empty subsector when this family fits but no child is supported.`,
      ...sectors.map((s) =>
        `- ${s.id}: ${s.label}. Needs ${s.needs}. Includes ${s.includes}.`
        + (s.excludes ? ` Does not include ${s.excludes}.` : '')),
    ].join('\n');
  }).filter(Boolean).join('\n\n');
}
