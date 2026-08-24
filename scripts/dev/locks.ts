import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  const r = await q`select pid, state, wait_event_type, left(query,60) as query,
    now()-query_start as dur from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid()`;
  console.table(r);
})();
