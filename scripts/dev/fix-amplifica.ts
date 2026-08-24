import '../../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb } from '../../lib/db';
import { companies } from '../../lib/schema';
(async () => {
  const db = getDb();
  // amplifica.com is a digital agency; AMPLIFICA HOLDINGS is a biotech.
  // Same name, different company - the false-merge failure. Clear it.
  await db.update(companies).set({
    website: null,
    description: 'Form D industry group: Biotechnology',
  }).where(eq(companies.name, 'AMPLIFICA HOLDINGS GROUP, INC.'));
  // aevos.com was a parked page.
  await db.update(companies).set({
    website: null,
    description: 'Form D industry group: Computers',
  }).where(eq(companies.name, 'Aevos AI Inc.'));
  console.log('cleared 2 wrong websites');
})();
