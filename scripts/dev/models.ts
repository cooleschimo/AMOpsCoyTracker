import '../../lib/loadenv';
import { listModels } from '../../lib/llm';
(async () => (await listModels()).forEach((m) => console.log('  ' + m)))();
