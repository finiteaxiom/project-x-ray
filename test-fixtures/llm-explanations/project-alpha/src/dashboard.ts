export function describeState(state: string): string {
  return state;
}

export function renderDashboard(state: string, mode: string, handlers: Record<string, () => string>): string {
  function describeState(value: string): string {
    return `panel:${value}`;
  }

  if (mode === "panel") {
    return describeState(state);
  }

  const selected = handlers[mode];
  const result = selected();
  return describeState(result);
}

export function buildOverview(state: string, mode: string, handlers: Record<string, () => string>): string {
  const title = describeState(state);
  return `${title} ${renderDashboard(state, mode, handlers)}`;
}
