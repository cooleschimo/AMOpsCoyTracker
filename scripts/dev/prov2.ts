import '../../lib/loadenv';
import { llmProviders } from '../../lib/env';
(async () => {
  for (const p of llmProviders()) {
    const r = await fetch(p.baseUrl+'/chat/completions',{method:'POST',
      headers:{Authorization:'Bearer '+p.apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:p.model,messages:[{role:'user',content:'hi'}]}),signal:AbortSignal.timeout(20000)});
    console.log((p.label??p.name).padEnd(12), r.status, r.ok?'READY':'exhausted');
    await new Promise(x=>setTimeout(x,600));
  }
})();
