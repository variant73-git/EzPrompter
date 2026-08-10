import { describe, expect, it } from 'vitest';
import { canonicalizeReferenceUrl } from './reference-bank-normalize.js';
import {
  mergeReferenceAppearances,
  parseCodropsPayload,
  parseMinimalGalleryDetailPayload,
  parseMinimalGalleryListingPayload,
  parsePafoliosPayload,
  parseSiteOfSitesDetailPayload,
  parseSiteOfSitesListingPayload,
  parseSiteInspirePayload,
  selectSiteOfSitesSitemapIncrement,
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

  it('keeps one canonical site when two real aggregators use different referral URLs', () => {
    const [reference] = mergeReferenceAppearances([
      {
        title: 'Celtic Sea Salt',
        url: 'https://celticseasalt.com/?ref=minimal.gallery',
        source: { id: 'minimalgallery', name: 'Minimal Gallery', listingUrl: 'https://minimal.gallery', recordId: '1' },
      },
      {
        title: 'Celtic Sea Salt',
        url: 'https://celticseasalt.com/',
        source: { id: 'siteofsites', name: 'Site of Sites', listingUrl: 'https://www.siteofsites.co', recordId: 'celtic-sea-salt' },
      },
    ], '2026-07-31T00:00:00.000Z');

    expect(reference.url).toBe('https://celticseasalt.com');
    expect(reference.sourceIds).toEqual(['minimalgallery', 'siteofsites']);
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

  it('extracts a Minimal Gallery listing card and exact detail metadata', () => {
    const listing = parseMinimalGalleryListingPayload({ html: `
      <div id="post-27340" class="post website">
        <div class="media">
          <a href="https://minimal.gallery/felix-peault/"><img src="https://minimal.gallery/felix-card.jpg"></a>
          <a class="site-button" title="Visit website" href="https://www.felixpeault.com/?ref=minimal.gallery"></a>
        </div>
        <h3><a href="https://minimal.gallery/felix-peault/">Félix Péault</a></h3>
        <time datetime="2026-07-30T17:05:12+08:00">today</time>
      </div>
    ` })[0];
    const [detail] = parseMinimalGalleryDetailPayload({
      metadata: { sourceURL: 'https://minimal.gallery/felix-peault/' },
      html: `
        <h1>Félix Péault</h1>
        <a class="single-post-breadcrumbs-button" title="Visit website" href="https://www.felixpeault.com/?ref=minimal.gallery"></a>
        <div class="meta-tags-list"><a>Portfolio</a><a>Photography</a></div>
        <div class="meta-date"><div class="meta-col">Published</div><div class="meta-col">July 30, 2026</div></div>
        <div class="single-post-media">
          <span class="desktop"><img src="https://minimal.gallery/felix-desktop.jpg"></span>
          <span class="mobile"><img src="https://minimal.gallery/felix-mobile.jpg"></span>
        </div>
      `,
    }, listing);

    expect(listing).toMatchObject({
      sourceRecordId: '27340',
      title: 'Félix Péault',
      publishedAt: '2026-07-30',
    });
    expect(detail).toMatchObject({
      url: 'https://www.felixpeault.com/?ref=minimal.gallery',
      tags: ['Portfolio', 'Photography'],
      publishedAt: '2026-07-30',
      thumbnailUrl: 'https://minimal.gallery/felix-desktop.jpg',
      source: { taxonomy: { mobileThumbnailUrl: 'https://minimal.gallery/felix-mobile.jpg' } },
    });
  });

  it('extracts a Site of Sites listing item and exact detail metadata', () => {
    const listing = parseSiteOfSitesListingPayload({ html: `
      <div role="listitem">
        <a href="https://www.siteofsites.co/websites/the-list"><img alt="The List" src="https://static.wixstatic.com/the-list-card.png"></a>
        <p>The List</p><p>07/2026</p><a href="https://thelist.design/"></a>
      </div>
    ` })[0];
    const [detail] = parseSiteOfSitesDetailPayload({
      metadata: { sourceURL: 'https://www.siteofsites.co/websites/the-list' },
      html: `
        <h1>The List</h1><p>Jul 21, 2026</p>
        <a aria-label="Live Site" href="https://thelist.design/">Live Site</a>
        <img alt="The List" src="https://static.wixstatic.com/the-list-detail.png">
      `,
    }, listing);

    expect(listing).toMatchObject({
      sourceRecordId: 'the-list',
      url: 'https://thelist.design/',
      publishedAt: '2026-07',
    });
    expect(detail).toMatchObject({
      title: 'The List',
      publishedAt: '2026-07-21',
      thumbnailUrl: 'https://static.wixstatic.com/the-list-detail.png',
    });
  });

  it('selects a bounded Site of Sites sitemap increment in source order', () => {
    expect(selectSiteOfSitesSitemapIncrement([
      { url: 'https://www.siteofsites.co/' },
      { url: 'https://www.siteofsites.co/websites/' },
      { url: 'https://www.siteofsites.co/websites/nested/child' },
      { url: 'https://www.siteofsites.co/websites/already-seen' },
      { url: 'https://www.siteofsites.co/websites/next-one?preview=true' },
      { url: 'http://siteofsites.co/websites/next-one/' },
      { url: 'https://www.siteofsites.co/websites/next-two' },
      { url: 'https://example.com/websites/not-this-source' },
      { url: 'https://www.siteofsites.co/websites/outside-the-limit' },
    ], [
      'https://www.siteofsites.co/websites/already-seen/',
    ], 2)).toEqual([
      'https://www.siteofsites.co/websites/next-one',
      'https://www.siteofsites.co/websites/next-two',
    ]);
  });

  it('extracts a Site of Sites sitemap-selected detail without listing metadata', () => {
    const [detail] = parseSiteOfSitesDetailPayload({
      metadata: { sourceURL: 'https://www.siteofsites.co/websites/from-sitemap' },
      html: `
        <h1>From Sitemap</h1><p>Jul 20, 2026</p>
        <a aria-label="Live Site" href="https://from-sitemap.example/">Live Site</a>
        <img alt="From Sitemap" src="https://static.wixstatic.com/from-sitemap.png">
      `,
    });

    expect(detail).toMatchObject({
      title: 'From Sitemap',
      url: 'https://from-sitemap.example/',
      publishedAt: '2026-07-20',
      source: {
        id: 'siteofsites',
        recordId: 'from-sitemap',
        listingUrl: 'https://www.siteofsites.co/',
      },
    });
  });

  it('uses a Site of Sites detail page when the listing omits its external target', () => {
    const listing = parseSiteOfSitesListingPayload({ html: `
      <div role="listitem">
        <a href="https://www.siteofsites.co/websites/verenika-perla"><img alt="Verenika Perla" src="https://static.wixstatic.com/verenika.png"></a>
        <p>Verenika Perla</p><p>11/2023</p>
      </div>
    ` })[0];
    const [detail] = parseSiteOfSitesDetailPayload({
      metadata: { sourceURL: 'https://www.siteofsites.co/websites/verenika-perla' },
      html: '<h1>Verenika Perla</h1><p>Nov 8, 2023</p><a aria-label="Live Site" href="https://verenikaperla.com/">Live Site</a>',
    }, listing);

    expect(listing.source.taxonomy).toEqual({ targetMissingFromListing: true });
    expect(detail.url).toBe('https://verenikaperla.com/');
  });

  it('rejects a Site of Sites record when both listing and detail omit its destination', () => {
    const listing = parseSiteOfSitesListingPayload({ html: `
      <div role="listitem">
        <a href="https://www.siteofsites.co/websites/no-destination"><img alt="No Destination" src="https://static.wixstatic.com/no-destination.png"></a>
        <p>No Destination</p><p>07/2026</p>
      </div>
    ` })[0];
    const detail = parseSiteOfSitesDetailPayload({
      metadata: { sourceURL: 'https://www.siteofsites.co/websites/no-destination' },
      html: '<h1>No Destination</h1><p>Jul 31, 2026</p>',
    }, listing);

    expect(listing.source.taxonomy).toEqual({ targetMissingFromListing: true });
    expect(detail).toEqual([]);
  });
});
