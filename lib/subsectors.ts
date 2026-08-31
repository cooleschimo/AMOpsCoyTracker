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
  },
  {
    id: 'photonics',
    short: 'Photonics',
    broad: 'compute',
    label: 'Photonics and optical interconnect',
    needs: 'advanced packaging, optics fabrication, precision assembly',
    includes: 'optical I/O and chiplets, silicon photonics, beam steering, optical networking components, DSPs for optical links',
  },
  {
    id: 'quantum',
    short: 'Quantum',
    broad: 'compute',
    label: 'Quantum computing and sensing',
    needs: 'research partners, national programme demand, specialist talent',
    includes: 'quantum computers of any modality, quantum sensing, post-quantum security where it is the main product',
  },
  {
    id: 'ai_infrastructure',
    short: 'AI compute',
    broad: 'ai',
    label: 'AI compute infrastructure',
    needs: 'power, land, grid connection, data-centre siting, cooling',
    includes: 'GPU clouds, AI data centres, inference-serving platforms sold as capacity',
    excludes: 'chip designers, which are semiconductors',
  },
  {
    id: 'ai_models',
    short: 'Models',
    broad: 'ai',
    label: 'Foundation models and research labs',
    needs: 'compute, research talent, data agreements, government relationships',
    includes: 'frontier and open model labs, multimodal generation models, robot and protein foundation models',
  },
  {
    id: 'ai_software',
    short: 'AI software',
    broad: 'ai',
    label: 'AI applications and developer tools',
    needs: 'office space, sales and support staff, enterprise reference customers',
    includes: 'vertical AI SaaS (legal, healthcare, support), coding assistants, enterprise search, agent orchestration, evaluation and observability, data platforms',
    excludes: 'anything whose product is compute or a model rather than software over one',
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
  },
  {
    id: 'space',
    short: 'Space',
    broad: 'aerospace',
    label: 'Space systems',
    needs: 'launch access, ground stations, spectrum, export-control clearance',
    includes: 'satellites and buses, earth observation, in-space manufacturing, launch and reentry',
  },
  {
    id: 'advanced_manufacturing',
    short: 'Manufacturing',
    broad: 'industrial',
    label: 'Advanced manufacturing and industrial technology',
    needs: 'industrial land, plant capacity, skilled production workforce',
    includes: 'automated factories and machining, additive manufacturing as a product, industrial process technology',
  },
  {
    id: 'materials_energy',
    short: 'Materials',
    broad: 'industrial',
    label: 'Advanced materials, batteries and energy',
    needs: 'pilot plant, industrial land, utilities, offtake agreements',
    includes: 'battery materials and cells, graphene and novel materials, energy storage, clean energy generation, climate and recycling technology',
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
  },
  {
    id: 'defence_software',
    short: 'Defence software',
    broad: 'defence',
    label: 'Defence and national-security software',
    needs: 'security clearance, government relationships, secure hosting',
    includes: 'command and control, intelligence and ISR analysis, mission autonomy software, national-security data platforms',
  },

  // ---- life sciences -------------------------------------------------------
  {
    id: 'therapeutics',
    short: 'Therapeutics',
    broad: 'health',
    label: 'Therapeutics and drug development',
    needs: 'clinical trial sites, regulatory pathway, manufacturing capacity, research partners',
    includes: 'small molecules, biologics and antibodies, gene and cell therapy, gene editing, computational drug discovery where the product is the drug',
  },
  {
    id: 'biotech_platforms',
    short: 'Biotech tools',
    broad: 'health',
    label: 'Biotech platforms and tools',
    needs: 'lab space, research partners, instrument manufacturing',
    includes: 'research instruments and reagents, synthetic biology platforms, sequencing and omics tools, bioprocessing technology',
    excludes: 'companies developing their own drug, which are therapeutics',
  },
  {
    id: 'medtech_devices',
    short: 'Medical devices',
    broad: 'health',
    label: 'Medical devices and diagnostics',
    needs: 'regulatory approval, clinical partners, device manufacturing',
    includes: 'surgical robots, diagnostics and screening, imaging, implants and neural interfaces, wearable therapeutics',
  },
  {
    id: 'digital_health',
    short: 'Digital health',
    broad: 'health',
    label: 'Digital health and care delivery',
    needs: 'health system partners, clinical data agreements, local operations',
    includes: 'care delivery services, clinical workflow software, health data platforms',
    excludes: 'AI agents sold as software to any industry, which are ai_software',
  },

  // ---- other ---------------------------------------------------------------
  {
    id: 'fintech',
    short: 'Fintech',
    broad: 'finance',
    label: 'Financial technology',
    needs: 'regulatory licensing, banking partners, local entity',
    includes: 'payments, banking infrastructure, insurance and capital markets technology',
  },
  {
    id: 'software_platforms',
    short: 'Software',
    broad: 'digital',
    label: 'General software platforms',
    needs: 'office space, engineering talent, sales and support staff',
    includes: 'non-AI SaaS, productivity and collaboration tools, design software, databases, data platforms, developer tools, community platforms',
    excludes: 'AI-first software, which is ai_software; security software, which is cybersecurity',
  },
  {
    id: 'cybersecurity',
    short: 'Cybersecurity',
    broad: 'digital',
    label: 'Cybersecurity and trust infrastructure',
    needs: 'security talent, enterprise reference customers, regulated-sector buyers',
    includes: 'identity and permissions infrastructure, attack-surface management, software supply-chain security, secure infrastructure tooling',
  },
  {
    id: 'networking_connectivity',
    short: 'Networking',
    broad: 'digital',
    label: 'Networking and connectivity',
    needs: 'datacentre and telco partners, enterprise buyers, systems engineers',
    includes: 'cloud networking, routing and switching software, spectrum-management software, telecom network infrastructure',
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
