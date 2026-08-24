/**
 * ACRA open data (data.gov.sg). Brief §5.3, build step 6.
 *
 * The CKAN datastore_search endpoint returns uen, entity_name,
 * entity_status_description and registration_incorporation_date. Datasets are
 * split alphabetically by the entity's first character, one dataset per letter,
 * refreshed monthly.
 *
 * Two constraints shape everything below:
 *
 * 1. Matching is company-level. The published fields are UEN, entity name,
 *    address, activity classification and officer counts — officer names are not
 *    among them, so person-level matching has nothing to match on and a
 *    name-and-address heuristic would produce noise dressed as signal (§5.3,
 *    DESIGN_RATIONALE §14).
 *
 * 2. A registration is not operational presence. Every match carries its
 *    match_status (confirmed vs probable), the ACRA entity status and the
 *    incorporation date, so a struck-off shelf entity and a live operating
 *    subsidiary stay distinguishable in the digest.
 */

const CKAN = 'https://data.gov.sg/api/action/datastore_search';
const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

/**
 * Dataset id per leading character. ACRA publishes one file per letter plus an
 * "Others" file for names starting with a digit or symbol.
 *
 * The ids come from collection 2 ("ACRA Information on Corporate Entities"),
 * which lists all 27 child datasets; paginating /datasets surfaces only some of
 * them. Ids are stable, and a 404 is recorded as a source-health event.
 */
export const ACRA_DATASETS: Record<string, string> = {
  A: 'd_8575e84912df3c28995b8e6e0e05205a',
  B: 'd_3a3807c023c61ddfba947dc069eb53f2',
  C: 'd_c0650f23e94c42e7a20921f4c5b75c24',
  D: 'd_acbc938ec77af18f94cecc4a7c9ec720',
  E: 'd_124a9bd407c7a25f8335b93b86e50fdd',
  F: 'd_4526d47d6714d3b052eed4a30b8b1ed6',
  G: 'd_b58303c68e9cf0d2ae93b73ffdbfbfa1',
  H: 'd_fa2ed456cf2b8597bb7e064b08fc3c7c',
  I: 'd_85518d970b8178975850457f60f1e738',
  J: 'd_478f45a9c541cbe679ca55d1cd2b970b',
  K: 'd_5573b0db0575db32190a2ad27919a7aa',
  L: 'd_a2141adf93ec2a3c2ec2837b78d6d46e',
  M: 'd_9af9317c646a1c881bb5591c91817cc6',
  N: 'd_67e99e6eabc4aad9b5d48663b579746a',
  O: 'd_5c4ef48b025fdfbc80056401f06e3df9',
  Others: 'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7',
  P: 'd_181005ca270b45408b4cdfc954980ca2',
  Q: 'd_4130f1d9d365d9f1633536e959f62bb7',
  R: 'd_2b8c54b2a490d2fa36b925289e5d9572',
  S: 'd_df7d2d661c0c11a7c367c9ee4bf896c1',
  T: 'd_72f37e5c5d192951ddc5513c2b134482',
  U: 'd_0cc5f52a1f298b916f317800251057f3',
  V: 'd_e97e8e7fc55b85a38babf66b0fa46b73',
  W: 'd_af2042c77ffaf0db5d75561ce9ef5688',
  X: 'd_1cd970d8351b42be4a308d628a6dd9d3',
  Y: 'd_31af23fdb79119ed185c256f03cb5773',
  Z: 'd_4e3db8955fdcda6f9944097bef3d2724',
};

export type AcraEntity = {
  uen: string;
  name: string;
  status: string;              // "Live Company", "Struck Off", "In Liquidation", ...
  incorporatedOn: string | null;
  entityType: string | null;
  postalCode: string | null;
};

let lastCall = 0;
async function polite() {
  const wait = 400 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Query one ACRA letter-dataset. Never throws. */
export async function searchAcraDataset(datasetId: string, query: string, limit = 20): Promise<AcraEntity[]> {
  await polite();
  try {
    const url = `${CKAN}?resource_id=${encodeURIComponent(datasetId)}&q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const j = await res.json();
    const recs = j?.result?.records ?? [];
    return recs.map((r: Record<string, string>) => ({
      uen: r.uen ?? '',
      name: r.entity_name ?? '',
      status: r.entity_status_description ?? '',
      incorporatedOn: r.registration_incorporation_date || null,
      entityType: r.entity_type_description ?? null,
      postalCode: r.postal_code || null,
    })).filter((e: AcraEntity) => e.uen && e.name);
  } catch {
    return [];
  }
}

/** A live, operating entity — as opposed to a struck-off or dissolved shell. */
export function isLiveStatus(status: string): boolean {
  return /^live/i.test(status.trim());
}

/**
 * Match strength for a candidate ACRA entity against a company name.
 *
 * 'confirmed' requires the ACRA name to contain the company's distinctive
 * tokens contiguously. 'probable' means the tokens are present but scattered,
 * or the name is short enough to collide. Anything weaker is rejected: a false
 * Singapore entity is worse than none, because it turns into a claim an RD
 * would repeat to a founder.
 */
export function matchStrength(
  companyName: string,
  acraName: string,
  /**
   * How many distinct registry entities share this company's identity token.
   * The only trustworthy distinctiveness signal available — see the note on
   * `distinctive` below. Omit when unknown; the caller's ambiguity guard then
   * does the work.
   */
  collisions?: number,
): 'confirmed' | 'probable' | null {
  const fold = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  // Legal form and geography carry no identity — stripped from both sides.
  const LEGAL = /\b(pte|ltd|limited|private|inc|incorporated|llc|corp|corporation|co|company|plc|lp|llp|pbc)\b/g;
  const GEO = /\b(singapore|sg|asia|asiapac|pacific|apac|international|global)\b/g;
  // Descriptive words say what a business does, not which business it is.
  const DESCRIPTIVE = /^(labs?|systems?|solutions?|technologies|technology|industries|industry|ventures?|partners?|capital|group|holdings?|digital|consulting|services?|enterprises?|works?|studios?|projects?|minds?|data|ai|io)$/;

  const base = (x: string) => fold(x).replace(/[^a-z0-9\s]/g, ' ').replace(LEGAL, ' ').replace(GEO, ' ').replace(/\s+/g, ' ').trim();

  const cTokens = base(companyName).split(' ').filter(Boolean);
  const aTokens = base(acraName).split(' ').filter(Boolean);
  if (!cTokens.length || !aTokens.length) return null;

  // Identity = what is left after removing words that describe an activity.
  const cId = cTokens.filter((t) => !DESCRIPTIVE.test(t));
  const aId = aTokens.filter((t) => !DESCRIPTIVE.test(t));
  if (!cId.length || !aId.length) return null;

  const join = (xs: string[]) => xs.join('');
  const cIdc = join(cId);
  const aIdc = join(aId);

  /**
   * Is the identity distinctive enough to match on alone?
   *
   * The string itself cannot answer this. Length does not track it: "decagon"
   * (7) and "parallel" (8) are ordinary words while "figma" (5) is coined. Nor
   * does a dictionary check, in the other direction — "anthropic", "perplexity"
   * and "cognition" are all real English words and unmistakable company names.
   *
   * The honest signal is how many entities in the registry share the identity,
   * which the caller measures and passes in. Absent that count this falls back
   * to length, and the caller's ambiguity guard catches what slips through.
   */
  const distinctive = (id: string) => {
    if (collisions !== undefined) return collisions <= 2;
    return id.length >= 7;
  };

  // Identities match exactly.
  if (cIdc === aIdc) {
    // Did ACRA add descriptive words the company does not use? "DECAGON
    // CONSULTING" vs "Decagon", "TWELVE DATA" vs "Twelve Labs". Both reduce to
    // the same identity, so this check comes before declaring a match.
    const cDesc = cTokens.filter((t) => DESCRIPTIVE.test(t));
    const aDesc = aTokens.filter((t) => DESCRIPTIVE.test(t));
    const addedDescriptive = aDesc.filter((d) => !cDesc.includes(d));
    // Any word ACRA adds that the company does not use — descriptive or not —
    // is evidence of a different entity when the identity is not distinctive.
    const addedAny = aTokens.filter((t) => !cTokens.includes(t));

    if (addedDescriptive.length || addedAny.length) {
      // A distinctive identity survives an added descriptive word (ANDURIL
      // SYSTEMS is still Anduril). A common one does not.
      return distinctive(cIdc) ? 'confirmed' : null;
    }
    // Exact match, nothing added, but the identity collides with many other
    // registry entities: this may be a namesake. Flag rather than assert.
    if (!distinctive(cIdc)) return 'probable';
    // Nothing added beyond legal form and geography. "FIGMA SINGAPORE PTE.
    // LIMITED" lands here: the only additions are a country and a legal form,
    // neither of which suggests a different business.
    //
    // Length is measured on the FULL matched name, not the stripped identity:
    // "Luma AI" vs "LUMA AI (SG)" share both words, and the company uses "AI"
    // itself, so it is identity-bearing here rather than a generic descriptor.
    const matchedLength = cTokens.join('').length;
    if (matchedLength >= 5) return 'confirmed';
    // Very short identity (<5 chars) with an exact match — right entity or a
    // namesake; flag for human review rather than asserting it.
    return 'probable';
  }

  // ACRA identity CONTAINS the company identity (or vice versa).
  const contains = aIdc.includes(cIdc) || cIdc.includes(aIdc);
  if (contains) {
    if (!distinctive(cIdc)) return null;      // "harvey" in "harveynorman" -> reject
    return 'confirmed';
  }

  // Neither contains the other: only accept when every company token is present
  // and ACRA adds at most one word of its own.
  const allPresent = cId.every((t) => aId.some((x) => x === t));
  if (allPresent && aTokens.length <= cTokens.length + 1) {
    return distinctive(cIdc) ? 'probable' : null;
  }
  return null;
}

/**
 * Look a company up across ACRA. Tries the dataset for the company's first
 * letter, plus "Others" when the name starts with a digit or symbol.
 *
 * Returns every plausible match with its strength and leaves the choice to the
 * caller. A company can legitimately have several Singapore entities (holding,
 * sales, R&D), and collapsing them would lose the distinction between a live
 * subsidiary and a struck-off shell.
 */
export async function lookupCompany(companyName: string): Promise<Array<AcraEntity & { match: 'confirmed' | 'probable' }>> {
  const fold = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const cleaned = fold(companyName).replace(/[^a-z0-9\s]/g, ' ').trim();
  if (!cleaned) return [];

  const first = cleaned[0].toUpperCase();
  const datasetIds = [ACRA_DATASETS[first], ACRA_DATASETS.Others].filter(Boolean);

  // Query each distinctive token separately and merge the results.
  //
  // ACRA's search over-constrains on multi-token queries: "sambanova systems"
  // returns nothing while "SAMBANOVA" finds the entity, and "anduril
  // industries" misses three Anduril entities. Picking a single token by length
  // fails too — it chooses "industries" over "anduril". Querying each token and
  // filtering the union with matchStrength() is what holds across all cases.
  const SUFFIX = new Set(['inc','llc','ltd','corp','limited','incorporated','company','co','the','group','holdings','technologies','technology','labs','systems','solutions','industries','international','global','ventures','partners','capital','ai','io']);
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 4 && !SUFFIX.has(t));
  if (!tokens.length) return [];

  // Gather candidates first, then judge. The collision count — how many
  // distinct registry entities share this identity — is the only trustworthy
  // distinctiveness signal, and it is knowable only after the fetch.
  const candidates: AcraEntity[] = [];
  const seenUen = new Set<string>();
  for (const id of datasetIds) {
    for (const token of tokens.slice(0, 2)) {
      for (const e of await searchAcraDataset(id, token, 40)) {
        if (seenUen.has(e.uen)) continue;
        seenUen.add(e.uen);
        candidates.push(e);
      }
    }
  }

  const collisions = candidates.length;
  const out: Array<AcraEntity & { match: 'confirmed' | 'probable' }> = [];
  for (const e of candidates) {
    const m = matchStrength(companyName, e.name, collisions);
    if (m) out.push({ ...e, match: m });
  }
  // Ambiguity guard. A short, common-word name matches many unrelated entities:
  // "Harvey" returns HARVEY NORMAN (an Australian retailer), HARVEY
  // CONSTRUCTION, HARVEY BUILDERS. Name-only resolution cannot separate these,
  // and a wrongly asserted Singapore entity is the kind of false fact an RD
  // would repeat to a founder (DESIGN_RATIONALE §8), so this returns nothing and
  // leaves it to a human.
  if (out.length > 4) {
    const core = cleaned.replace(/\s+/g, '');
    if (core.length < 10) {
      console.warn(`[acra] "${companyName}" matched ${out.length} entities — too generic to resolve by name; returning none`);
      return [];
    }
  }

  // Confirmed before probable; live entities before struck-off.
  return out.sort((a, b) => {
    if (a.match !== b.match) return a.match === 'confirmed' ? -1 : 1;
    return (isLiveStatus(b.status) ? 1 : 0) - (isLiveStatus(a.status) ? 1 : 0);
  });
}
