import { describe, expect, it } from 'vitest';

import { ODARA_BUILD_INFO } from './build-info';

describe('build-info', () => {
  it('exposes a safe runtime build marker', () => {
    expect(ODARA_BUILD_INFO.commit).toEqual(expect.any(String));
    expect(ODARA_BUILD_INFO.commit.length).toBeGreaterThan(0);
    expect(ODARA_BUILD_INFO.buildTime).toEqual(expect.any(String));
    expect(ODARA_BUILD_INFO.buildTime.length).toBeGreaterThan(0);
    expect(ODARA_BUILD_INFO.packageVersion).toEqual(expect.any(String));
  });
});
