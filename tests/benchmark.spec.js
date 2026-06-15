import { test, expect } from '@playwright/test';

// Benchmark page e2e. Runs a small subset (1 tune × 1 dependency-free
// detector) — full matrices are for manual detector development, not CI.

test.describe('benchmark page', () => {
  test('loads with detector and tune selection', async ({ page }) => {
    await page.goto('/benchmark.html');
    await expect(page.locator('h1')).toContainText('Benchmark');
    expect(await page.locator('input[name="detector"]').count()).toBe(1);
    expect(await page.locator('input[name="tune"]').count()).toBe(9);
    await expect(page.locator('#runBenchmark')).toBeEnabled();
  });

  test('injected run reports correct key and is deterministic', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/benchmark.html');
    await page.waitForFunction(() => !!window.fiddlekeyBenchmark);

    const runOnce = () => page.evaluate(async () => {
      return await window.fiddlekeyBenchmark.run({
        detectors: ['essentia'],
        tunes: ['c_major'],
        durationSec: 15,
        noise: { type: 'session', snrDb: 15, seed: 1 }
      });
    });

    const first = await runOnce();
    expect(first).toHaveLength(1);
    const row = first[0];
    expect(row.error).toBeUndefined();
    expect(row.expected).toEqual({ tonic: 'C', mode: 'major' });
    expect(row.updateCount).toBeGreaterThan(5);
    expect(row.final).not.toBeNull();
    // Don't assert final correctness — that's the detector's score, which the
    // benchmark exists to measure. But the synth must produce audio in which
    // the detector recognizes C major at least once.
    expect(row.firstCorrectMs).not.toBeNull();

    // Note safety = the product answer.
    expect(row.noteSafety).not.toBeNull();
    expect(Array.isArray(row.noteSafety.safe)).toBe(true);
    const nm = row.noteSafetyMetrics;
    expect(nm).toBeTruthy();
    for (const key of ['safePrecision', 'safeRecall', 'dangerousGreenCount', 'avoidFalseNegativeCount', 'usefulGreenCount', 'ambiguityHandled', 'score']) {
      expect(typeof nm[key]).toBe('number');
    }
    // C major synth should not be told to play out-of-scale notes as safe green.
    expect(nm.dangerousGreenCount).toBe(0);

    // Results rendered in the page too.
    await expect(page.locator('#results-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#summary-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#benchmark-json')).toContainText('"detectorId": "essentia"');
    await expect(page.locator('#benchmark-json')).toContainText('"noteSafetyMetrics"');

    // Determinism: identical options -> identical detection trace
    // (wallMs is real time, so compare everything except it).
    const second = await runOnce();
    const stripWall = (rows) => rows.map(({ wallMs, ...rest }) => rest);
    expect(stripWall(second)).toEqual(stripWall(first));
  });
});
