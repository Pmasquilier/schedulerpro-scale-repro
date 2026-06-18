import { createRoot } from 'react-dom/client';
import { App } from './App';

// NOTE: intentionally NOT wrapped in <StrictMode>. This is a perf-measurement harness; in dev,
// StrictMode double-invokes effects, which would double every load() / loadInlineData() and
// distort the mount/reconcile timings we are here to measure.
async function bootstrap() {
  // MSW mocks the REST backend (POST /api/events/batch) so the CrudManager strategy can sync
  // through a REAL fetch + syncUrl — the production-shaped Option A — with no server running.
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });

  createRoot(document.getElementById('root')!).render(<App />);
}

void bootstrap();
