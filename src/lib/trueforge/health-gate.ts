export type HealthSample = {
  pid: number | null;
  healthOk: boolean;
};

/** True when the process identity stayed put and the sidecar is answering. */
export function sidecarWatchOk(samples: HealthSample[]): boolean {
  if (samples.length === 0) return false;
  const first = samples[0]?.pid;
  if (first == null) return false;
  if (samples.some((sample) => sample.pid !== first)) return false;
  return samples[samples.length - 1]?.healthOk === true;
}

export async function watchSidecarHealth(input: {
  samples: number;
  read: () => Promise<HealthSample>;
  sleep?: () => Promise<void>;
}): Promise<{ ok: boolean; samples: HealthSample[] }> {
  const sleep = input.sleep ?? (() => Promise.resolve());
  const samples: HealthSample[] = [];
  for (let i = 0; i < input.samples; i++) {
    samples.push(await input.read());
    if (i < input.samples - 1) await sleep();
  }
  return { ok: sidecarWatchOk(samples), samples };
}
