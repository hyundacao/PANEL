const stationSearchTokens = (value: string): string[] => (value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\u0142/g, 'l')
  .match(/[a-z]+|\d+/g) ?? [])
  .map(token => token === 'wtry' ? 'wtr' : /^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, '') : token);

export const matchesProductionPlanStation = (station: string, query: string): boolean => {
  if (!query.trim()) return true;
  const searchTokens = stationSearchTokens(query);
  if (!searchTokens.length) return false;
  const stationTokens = stationSearchTokens(station);
  return searchTokens.every(search => stationTokens.some(token =>
    /^\d+$/.test(search) ? token === search : token.startsWith(search)
  ));
};
