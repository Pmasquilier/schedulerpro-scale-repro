import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LazyOrchestrationRepro } from './repro/LazyOrchestrationRepro';

// NOTE: intentionally NOT wrapped in <StrictMode>. This is a measurement harness; in dev,
// StrictMode double-invokes effects, which would double every load() and distort the timings
// (and the request counts we watch for Behavior B).
// Two independent repros share this entry:
//   - default     → perf/accumulation repro (bug #1, eventStore.lazyLoad:false)
//   - ?repro=lazy → lazy-load ORCHESTRATION repro (A/B/C, eventStore.lazyLoad:true)
const lazyRepro = new URLSearchParams(window.location.search).get('repro') === 'lazy';
createRoot(document.getElementById('root')!).render(lazyRepro ? <LazyOrchestrationRepro /> : <App />);
