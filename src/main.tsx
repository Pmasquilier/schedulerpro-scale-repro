import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LazyOrchestrationRepro } from './repro/LazyOrchestrationRepro';
import { FilterAutoLoadRepro } from './repro/FilterAutoLoadRepro';

// NOTE: intentionally NOT wrapped in <StrictMode>. This is a measurement harness; in dev,
// StrictMode double-invokes effects, which would double every load() and distort the timings
// (and the request counts we watch for Behavior B).
// Independent repros share this entry, selected by ?repro=:
//   - default       → perf/accumulation repro (bug #1, eventStore.lazyLoad:false)
//   - ?repro=lazy    → lazy-load ORCHESTRATION repro (A/B/C, eventStore.lazyLoad:true)
//   - ?repro=filter  → filtering & autoLoad repro (forum t=35495): in-store filter vs external reload
const repro = new URLSearchParams(window.location.search).get('repro');
const Root = repro === 'lazy' ? LazyOrchestrationRepro : repro === 'filter' ? FilterAutoLoadRepro : App;
createRoot(document.getElementById('root')!).render(<Root />);
