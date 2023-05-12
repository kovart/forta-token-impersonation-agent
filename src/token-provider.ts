// TODO refactor the class to use it as token fetcher, comparator and the source of truth

class TokenProvider {
  private popularHashSet = new Set<string>();

  constructor(popularTokens: { symbol?: string | null; name?: string | null }[]) {
    for (const token of popularTokens) {
      this.popularHashSet.add(this.getHash(token));
    }
  }

  public isPopularToken(token: { symbol: string | null; name: string | null }) {
    return this.popularHashSet.has(this.getHash(token));
  }

  private getHash(token: { symbol?: string | null; name?: string | null }) {
    return `${token.name || ''} (${token.symbol || ''})`;
  }
}

export default TokenProvider;
