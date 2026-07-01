import { test, expect } from '@playwright/test';

/**
 * Regression guard for the mount-metric bug: the "Mount" number used to be reported BEFORE the
 * scheduler finished painting its event bars (lazy stopped right after the resource rows loaded;
 * non-lazy stopped two frames after data assignment, while Pro kept committing rows). So the
 * displayed time was a lower bound, not "everything visible".
 *
 * The invariant we assert: AT THE INSTANT the Mount metric flips from "—" to a number, the event
 * bars are already in the DOM and their count does NOT keep growing afterwards. If the metric
 * fires early, `countAtMetric` is far below the settled `countFinal` and the test fails.
 */

const EVENT_SELECTOR = '.b-sch-event-wrap';

// Captured in-page so we read the bar count at the exact moment the metric text changes — a
// Node-side poll would miss the transition. Resolves { countAtMetric }.
async function countWhenMetricAppears(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    ([sel]) =>
      new Promise<number>((resolve) => {
        const node = document.querySelector('[data-testid="metric-mount"]');
        if (!node) {
          resolve(-1);
          return;
        }
        const isNumber = () => /\d/.test(node.textContent ?? '');
        const count = () => document.querySelectorAll(sel as string).length;
        if (isNumber()) {
          resolve(count());
          return;
        }
        const obs = new MutationObserver(() => {
          if (isNumber()) {
            obs.disconnect();
            resolve(count());
          }
        });
        obs.observe(node, { childList: true, characterData: true, subtree: true });
      }),
    [EVENT_SELECTOR],
  );
}

// Single strategy now: the windowed CrudManager (PR #12440). One route, no hash.
for (const route of ['/'] as const) {
  test(`mount metric reflects fully-painted DOM (${route})`, async ({ page }) => {
    // Navigate before the metric is set, so the in-page observer catches the flip.
    await page.goto(route, { waitUntil: 'domcontentloaded' });

    const countAtMetric = await countWhenMetricAppears(page);

    // Let any further async rendering happen — with the fix there should be none.
    await page.waitForTimeout(2500);
    const countFinal = await page.locator(EVENT_SELECTOR).count();

    // The metric must report a number, and the bars must already be painted when it does.
    const metricText = await page.getByTestId('metric-mount').textContent();
    expect(metricText).toMatch(/\d/);
    expect(countAtMetric).toBeGreaterThan(0);
    expect(countFinal).toBeGreaterThan(0);

    // Core invariant: nothing meaningful painted AFTER the metric was reported.
    // (Small tolerance for stray late nodes; the bug produced gaps of dozens-to-hundreds.)
    expect(countFinal - countAtMetric).toBeLessThanOrEqual(2);
  });
}
