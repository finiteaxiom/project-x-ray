export function describeState(state: string): string {
  return `beta:${state}`;
}

export function buildOverview(state: string): string {
  return describeState(state);
}
