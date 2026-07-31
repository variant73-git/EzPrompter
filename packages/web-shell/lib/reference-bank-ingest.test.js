import { describe, expect, it } from 'vitest';
import { canonicalizeReferenceUrl } from './reference-bank-normalize.js';
import {
  mergeReferenceAppearances,
  parseCodropsPayload,
  parsePafoliosPayload,
  parseSiteInspirePayload,
} from './reference-bank-ingest.js';

describe('reference bank normalization', () => {
  it('normalizes protocol, www, trailing slash, and referral parameters', () => {
    expect(canonicalizeReferenceUrl('http://www.Antinomy.Studio/?ref=siteinspire&utm_source=x#work')).toEqual({
      canonicalKey: 'antinomy.studio',
      canonicalUrl: 'https://antinomy.studio',
      host: 'antinomy.studio',
    });
  });

  it('merges appearances without losing source provenance', () => {
    const base = {
      title: 'Antinomy',
      url: 'https://antinomy.studio/',
      thumbnailUrl: 'https://images.example/one.jpg',
      categories: ['Studio'],
      tags: [],
      featured: true,
    };
    const [reference] = mergeReferenceAppearances([
      { ...base, source: { id: 'codrops', name: 'Codrops', listingUrl: 'https://codrops.example', recordId: '1' } },
      { ...base, url: 'https://www.antinomy.studio/?ref=siteinspire', source: { id: 'siteinspire', name: 'SiteInspire', listingUrl: 'https://siteinspire.example', recordId: '2' } },
    ], '2026-07-31T00:00:00.000Z');

    expect(reference.url).toBe('https://antinomy.studio');
    expect(reference.editorialConsensus).toBe(2);
    expect(reference.sourceIds).toEqual(['codrops', 'siteinspire']);
    expect(reference.sources).toHaveLength(2);
  });
});

describe('reference source adapters', () => {
  it('extracts Codrops cards', () => {
    const items = parseCodropsPayload({ rawHtml: `
      <article class="ct-webzibition" id="post-7">
        <a class="ct-latest-thumb-webzibition" href="https://example.com/"><img src="https://images.example/thumb.jpg"></a>
        <h2 class="title-archive"><a>Example</a></h2>
      </article>
    ` });
    expect(items[0]).toMatchObject({ title: 'Example', url: 'https://example.com/', thumbnailUrl: 'https://images.example/thumb.jpg' });
  });

  it('extracts the embedded Pafolios collection without visiting every detail page', () => {
    const flight = `f:{"portfolios":[{"id":"2026-07-31","title":"Maker","description":"Portfolio","categories":["Designer"],"tags":["Motion"],"websiteUrl":"https://maker.example/","imageUrl":"/portfolio-images/maker.jpg","featured":true,"date":"2026-07-31","slug":"maker"}]}`;
    const rawHtml = `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script>`;
    const items = parsePafoliosPayload({ rawHtml });
    expect(items[0]).toMatchObject({
      title: 'Maker',
      url: 'https://maker.example/',
      categories: ['Designer'],
      thumbnailUrl: 'https://pafolios.com/portfolio-images/maker.jpg',
    });
  });

  it('pairs SiteInspire collection metadata with the external target link', () => {
    const detail = 'https://www.siteinspire.com/website/42-example';
    const items = parseSiteInspirePayload({
      rawHtml: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'CollectionPage',
        hasPart: [{ name: 'Example', image: 'thumb.jpg?ar=16/10', url: detail, datePublished: '2026-07-31' }],
      })}</script>`,
      links: [detail, 'https://example.com/?ref=siteinspire', 'https://www.siteinspire.com/profile/1-studio'],
    });
    expect(items[0]).toMatchObject({ title: 'Example', url: 'https://example.com/?ref=siteinspire', sourceRecordId: '42' });
    expect(items[0].thumbnailUrl).toContain('/thumb.jpg');
  });
});
