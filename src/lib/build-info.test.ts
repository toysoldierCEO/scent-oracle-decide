import { describe, expect, it } from 'vitest';

import { exposeOdaraBuildInfo, ODARA_BUILD_INFO } from './build-info';

describe('build-info', () => {
  it('exposes a safe runtime build marker', () => {
    expect(ODARA_BUILD_INFO.commit).toEqual(expect.any(String));
    expect(ODARA_BUILD_INFO.commit.length).toBeGreaterThan(0);
    expect(ODARA_BUILD_INFO.buildTime).toEqual(expect.any(String));
    expect(ODARA_BUILD_INFO.buildTime.length).toBeGreaterThan(0);
    expect(ODARA_BUILD_INFO.packageVersion).toEqual(expect.any(String));
  });

  it('writes the safe build marker to the DOM for runtime verification', () => {
    exposeOdaraBuildInfo();

    expect(window.__ODARA_BUILD__).toBe(ODARA_BUILD_INFO);
    expect(document.documentElement.dataset.odaraBuildCommit).toBe(ODARA_BUILD_INFO.commit);
    expect(document.documentElement.dataset.odaraBuildTime).toBe(ODARA_BUILD_INFO.buildTime);
  });
});
