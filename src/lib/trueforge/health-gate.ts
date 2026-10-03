export type Pm2Sample = {
  pid: number;
  restartCount: number;
  healthOk: boolean;
};

/**
 * Pass when reload raises restart_time by at most 1 and every later sample
 * keeps that pid and count, and the last sample got HTTP 200.
 */
export function pm2ReloadStable(beforeCount: number, samples: Pm2Sample[]): boolean {
  if (!Number.isInteger(beforeCount) || beforeCount < 0 || samples.length === 0) return false;
  const after = samples[0];
  if (!after) return false;
  if (after.restartCount < beforeCount || after.restartCount > beforeCount + 1) return false;
  for (const sample of samples) {
    if (sample.pid !== after.pid || sample.restartCount !== after.restartCount) return false;
  }
  return samples[samples.length - 1]?.healthOk === true;
}
