import '../../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb } from '../../lib/db';
import { companies } from '../../lib/schema';
(async () => {
  const db = getDb();
  // Marked rather than removed, so the audit trail keeps the artefact.
  await db.update(companies)
    .set({ scopeStatus: 'out_of_scope', scopeReason: 'extraction artefact: nav chrome parsed as a company name' })
    .where(eq(companies.id, 1320));
  console.log('marked #1320 (Offices) as extraction artefact');
})();
