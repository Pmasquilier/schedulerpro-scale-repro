import { http, HttpResponse } from 'msw';
import { backend } from '../api/fakeBackend';

// Mock of the backend endpoint the sync POST hits. The app's own client issues this request
// (so its HTTP interceptors fire) — Bryntum no longer fetches. The endpoint speaks OUR language
// (a batch of event updates) — it knows nothing about Bryntum; the Bryntum <-> REST translation
// lives entirely in `encode`/`decode` on the front (see crudBackend.ts). A real backend would
// expose a transactional batch endpoint that reuses its existing per-record update + validation.

interface BatchUpdateItem {
  id: string;
  startDate: string;
  endDate: string;
  resourceId: number;
}
interface BatchUpdateBody {
  requestId?: number;
  updates: BatchUpdateItem[];
}

function parseBody(raw: string): BatchUpdateBody {
  // `encode` returns JSON; AjaxTransport may post it raw or wrapped as a `data=` form param.
  try {
    return JSON.parse(raw) as BatchUpdateBody;
  } catch {
    const data = new URLSearchParams(raw).get('data');
    return data ? (JSON.parse(data) as BatchUpdateBody) : { updates: [] };
  }
}

export const handlers = [
  http.post('/api/events/batch', async ({ request }) => {
    const { requestId, updates = [] } = parseBody(await request.text());
    console.info('[msw] POST /api/events/batch —', updates.length, 'update(s)', updates[0]);

    // Transactional all-or-nothing: any failure fails the whole batch (mock — fakeBackend never
    // throws, but this is where a real backend's rollback semantics would surface).
    try {
      await Promise.all(updates.map((u) => backend.moveShift(u)));
    } catch (e) {
      return HttpResponse.json({ success: false, requestId, message: String(e) }, { status: 500 });
    }
    return HttpResponse.json({ success: true, requestId });
  }),
];
