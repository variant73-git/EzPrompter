import { describe, expect, it } from 'vitest';
import {
  landbookListingPageNumber,
  landbookListingPageUrl,
  parseLandbookDetailPayload,
  parseLandbookListingPayload,
} from './reference-bank-landbook.js';

describe('Landbook listing boundary', () => {
  it('allows only the unfiltered public page progression', () => {
    expect(landbookListingPageUrl()).toBe('https://land-book.com/');
    expect(landbookListingPageUrl(6)).toBe('https://land-book.com/?page=6');
    expect(landbookListingPageNumber('https://www.land-book.com/?page=6')).toBe(6);
    expect(landbookListingPageNumber('https://land-book.com/?sort=featured')).toBeNull();
    expect(landbookListingPageNumber('https://land-book.com/?page=6&style=animation')).toBeNull();
    expect(landbookListingPageNumber('https://land-book.com/?page=0')).toBeNull();
    expect(landbookListingPageNumber('http://land-book.com/?page=6')).toBeNull();
    expect(landbookListingPageNumber('https://land-book.com:8443/?page=6')).toBeNull();
    expect(landbookListingPageNumber('https://land-book.com/?page=999999999999999999999')).toBeNull();
    expect(() => landbookListingPageUrl(0)).toThrow(/positive integer/);
  });
});

describe('Landbook source adapter', () => {
  it('partitions websites, templates, ads, and rejected cards without mixing their identities', () => {
    const parsed = parseLandbookListingPayload({
      metadata: { sourceURL: 'https://land-book.com/?page=6' },
      html: `
        <div class="websites">
          <div class="website-item" data-analytics-item-id="98186">
            <div class="website-item-picture">
              <a data-website-link href="/websites/98186-taste-labs-the-taste-layer-for-ai">
                <img src="https://cdn.land-book.com/site.webp?signature=signed" alt="Taste Labs">
              </a>
            </div>
            <div class="website-item-details">
              <a class="fw-bold" href="/websites/98186-taste-labs-the-taste-layer-for-ai">Taste Labs</a>
              <a href="/design/landing-page">Landing Page</a>
            </div>
            <a rel="noopener sponsored" href="https://try.webflow.com/affiliate" aria-label="This website is made with Webflow"></a>
            <a data-analytics-link-type="visit_button" data-analytics-website-id="98186" aria-label="Visit website" href="https://tastelabs.com/?ref=land-book.com"></a>
          </div>
          <div class="website-item" data-analytics-item-id="97689">
            <div class="website-item-picture">
              <a data-website-link href="/websites/97689-arion-framer-dark-ai-website-template">
                <img src="https://cdn.land-book.com/template.webp?signature=signed" alt="Arion template">
              </a>
            </div>
            <div class="website-item-details">
              <a class="fw-bold" href="/websites/97689-arion-framer-dark-ai-website-template">Arion</a>
              <a href="/templates">Template</a>
              <a class="website-item-link" href="/websites/97689-arion-framer-dark-ai-website-template">For free</a>
            </div>
          </div>
          <div class="website-item" data-analytics-item-id="99999">
            <a data-website-link href="/websites/99999-missing-target"><img src="missing.webp"></a>
            <a class="fw-bold" href="/websites/99999-missing-target">Missing target</a>
          </div>
          <a class="campaign-ad-link" rel="noopener sponsored" href="https://framer.link/campaign" aria-label="Framer campaign">
            <img src="https://cdn.land-book.com/ad.webp">
          </a>
        </div>
      `,
    });

    expect(parsed).toMatchObject({ page: 6, listingUrl: 'https://land-book.com/?page=6' });
    expect(parsed.appearances).toHaveLength(1);
    expect(parsed.appearances[0]).toMatchObject({
      sourceRecordId: '98186',
      title: 'Taste Labs',
      url: 'https://tastelabs.com/?ref=land-book.com',
      thumbnailUrl: 'https://cdn.land-book.com/site.webp?signature=signed',
      categories: ['Website', 'Landing Page'],
      publishedAt: null,
      source: {
        id: 'landbook',
        listingUrl: 'https://land-book.com/?page=6',
        taxonomy: { lane: 'website', listingPage: 6 },
      },
    });
    expect(parsed.templates).toEqual([expect.objectContaining({
      lane: 'template',
      sourceRecordId: '97689',
      sourceDetailUrl: 'https://land-book.com/websites/97689-arion-framer-dark-ai-website-template',
      priceLabel: 'For free',
    })]);
    expect(parsed.advertisements).toEqual([expect.objectContaining({
      lane: 'advertisement',
      sourceRecordId: 'page-6-ad-1',
      targetUrl: 'https://framer.link/campaign',
      sponsored: true,
    })]);
    expect(parsed.rejections).toEqual([expect.objectContaining({
      lane: 'website',
      sourceRecordId: '99999',
      reason: 'missing_target_url',
    })]);
  });

  it('rejects filtered listing URLs before parsing cards', () => {
    expect(() => parseLandbookListingPayload({ html: '<div class="website-item"></div>' }, 'https://land-book.com/?style=animation'))
      .toThrow(/Unapproved Landbook listing URL/);
  });

  it('enriches the matching detail only and keeps verification separate from publication', () => {
    const fallback = parseLandbookListingPayload({
      html: `
        <div class="website-item" data-analytics-item-id="98186">
          <div class="website-item-picture"><a data-website-link href="/websites/98186-taste-labs-the-taste-layer-for-ai"><img src="card.webp"></a></div>
          <a class="fw-bold" href="/websites/98186-taste-labs-the-taste-layer-for-ai">Taste Labs</a>
          <a data-analytics-link-type="visit_button" data-analytics-website-id="98186" aria-label="Visit website" href="https://tastelabs.com/?ref=land-book.com"></a>
        </div>
      `,
    }).appearances[0];
    const [detail] = parseLandbookDetailPayload({
      metadata: { sourceURL: 'https://land-book.com/websites/98186-taste-labs-the-taste-layer-for-ai' },
      html: `
        <h1>Taste Labs - The taste layer for AI</h1>
        <span>Verified Jul 31</span>
        <div class="website-navbar">
          <a data-analytics-link-type="visit_button" data-analytics-website-id="98186" aria-label="Visit website" href="https://tastelabs.com/?ref=land-book.com">Visit</a>
        </div>
        <img data-website-img src="https://cdn.land-book.com/image/website/98186/desktop.webp?signature=desktop">
        <img data-expandable-content-img src="https://cdn.land-book.com/image/website/98186/mobile.webp?signature=mobile">
        <div class="website-sidebar-responsive">
          <a aria-label="Filter websites by category: Landing" href="/design/landing-page">Landing</a>
          <a aria-label="Filter websites by style: Animation" href="/?style=animation">Animation</a>
          <a aria-label="Filter websites by industry: AI" href="/?industry=ai">AI</a>
          <a aria-label="Filter websites by typography: Sans Serif" href="/?typography=sans-serif">Sans Serif</a>
          <a aria-label="Filter websites by platform: Webflow" href="/?platform=webflow">Webflow</a>
        </div>
        <div class="more-like-this">
          <a data-analytics-link-type="visit_button" data-analytics-website-id="42" aria-label="Visit website" href="https://wrong.example/">Visit another site</a>
        </div>
      `,
    }, fallback);

    expect(detail).toMatchObject({
      sourceRecordId: '98186',
      title: 'Taste Labs - The taste layer for AI',
      url: 'https://tastelabs.com/?ref=land-book.com',
      thumbnailUrl: 'https://cdn.land-book.com/image/website/98186/desktop.webp?signature=desktop',
      categories: ['Website', 'Landing'],
      tags: ['Animation', 'AI', 'Sans Serif', 'Webflow'],
      publishedAt: null,
      source: {
        id: 'landbook',
        taxonomy: {
          lane: 'website',
          category: ['Landing'],
          style: ['Animation'],
          industry: ['AI'],
          typography: ['Sans Serif'],
          platform: ['Webflow'],
          verifiedLabel: 'Verified Jul 31',
          mobileThumbnailUrl: 'https://cdn.land-book.com/image/website/98186/mobile.webp?signature=mobile',
        },
      },
    });
  });

  it('does not promote a template lane or mismatched detail into a website appearance', () => {
    const payload = {
      metadata: { sourceURL: 'https://land-book.com/websites/98186-taste-labs-the-taste-layer-for-ai' },
      html: '<a data-analytics-link-type="visit_button" data-analytics-website-id="98186" href="https://tastelabs.com/">Visit</a>',
    };
    expect(parseLandbookDetailPayload(payload, { lane: 'template' })).toEqual([]);
    expect(parseLandbookDetailPayload(payload, { sourceRecordId: '99999' })).toEqual([]);
  });
});
