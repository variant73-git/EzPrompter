import { describe, expect, it } from 'vitest';
import {
  BRAND_ATTRIBUTE_TAGS,
  DESIGN_INGREDIENT_MODEL,
  DESIGN_INGREDIENTS,
  getReferenceIngredientPreset,
  getReferenceTagPreset,
  MACRO_DESIGN_PRIORITIES,
  MAX_STYLE_TAGS,
  MAX_BRAND_ATTRIBUTES,
  PRODUCT_TYPE_TAGS,
  REFERENCE_TAG_PRESETS,
  SECTION_STRUCTURE_CONTRACT,
  STYLE_TAGS,
  TEXT_BLOCK_PRESETS,
} from './reference-design-taxonomy.js';

describe('reference design taxonomy', () => {
  it('keeps every calibrated reference inside the bounded taxonomies', () => {
    for (const preset of Object.values(REFERENCE_TAG_PRESETS)) {
      expect(preset.productTypes.every((tag) => PRODUCT_TYPE_TAGS.includes(tag))).toBe(true);
      expect(preset.styleTags.every((tag) => STYLE_TAGS.includes(tag))).toBe(true);
      expect(preset.styleTags.length).toBeLessThanOrEqual(MAX_STYLE_TAGS);
      expect((preset.brandAttributes || []).every((tag) => BRAND_ATTRIBUTE_TAGS.includes(tag))).toBe(true);
      expect((preset.brandAttributes || []).length).toBeLessThanOrEqual(MAX_BRAND_ATTRIBUTES);
    }
  });

  it('normalizes www hosts and returns defensive copies', () => {
    const first = getReferenceTagPreset('https://www.biograph.com/path');
    expect(first).toMatchObject({ productTypes: ['landing-page', 'corporate-site'], styleTags: ['soft-tech', 'corporate'], brandAttributes: ['sober', 'premium', 'authoritative'] });
    first.styleTags.push('minimal');
    first.brandAttributes.push('warm');
    expect(getReferenceTagPreset('biograph.com').styleTags).toEqual(['soft-tech', 'corporate']);
    expect(getReferenceTagPreset('biograph.com').brandAttributes).toEqual(['sober', 'premium', 'authoritative']);
  });

  it('makes mobile stability and measured type part of the contract', () => {
    expect(MACRO_DESIGN_PRIORITIES).toContain('mobile-stable-layout');
    expect(SECTION_STRUCTURE_CONTRACT.typography.singleReferenceScaleTolerance).toBe(0.15);
    expect(SECTION_STRUCTURE_CONTRACT.typography.measurementRule).toContain('letter-spacing');
    expect(TEXT_BLOCK_PRESETS.every((preset) => preset.mobile)).toBe(true);
  });

  it('componentizes brand personality separately from visual ingredients', () => {
    expect(getReferenceTagPreset('https://buckssauce.com')).toMatchObject({ brandAttributes: ['playful', 'extroverted', 'rebellious'] });
    expect(getReferenceIngredientPreset('https://buckssauce.com')).toMatchObject({ alignment: 'edge-distributed', typography: 'condensed-display' });
    expect(getReferenceIngredientPreset('https://ref.digital')).toBeNull();
    expect(DESIGN_INGREDIENT_MODEL.formula).toContain('palette + typography + motion');
    expect(DESIGN_INGREDIENTS.alignment).toContain('mixed');
  });

  it('keeps Ideogram as a cross-industry soft-tech calibration reference', () => {
    expect(getReferenceTagPreset('https://ideogram.ai')).toMatchObject({
      productTypes: ['saas', 'tool'],
      styleTags: ['soft-tech', 'minimal'],
      brandAttributes: ['technical', 'bold', 'approachable'],
    });
  });
});
