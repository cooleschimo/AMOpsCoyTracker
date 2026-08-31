import '../../lib/loadenv';
import { llmProviders } from '../../lib/env';
(async () => {
  for (const p of llmProviders()) {
    try {
      const r = await fetch(p.baseUrl+'/chat/completions', {method:'POST',
        headers:{Authorization:'Bearer '+p.apiKey,'Content-Type':'application/json'},
        body: JSON.stringify({model:p.model, messages:[{role:'user',content:'Return {"ok":true}'}]}),
        signal: AbortSignal.timeout(30000)});
      const t = await r.text();
      const q = (t.match(/"quotaId":\s*"([^"]+)"/)||[])[1];
      console.log((p.label??p.name).padEnd(12), r.status, r.ok ? 'READY' : (q ?? t.slice(0,70).replace(/\n/g,' ')));
    } catch(e:any){ console.log((p.label??p.name).padEnd(12),'ERR',e.message.slice(0,40)); }
    await new Promise(x=>setTimeout(x,800));
  }
})();
