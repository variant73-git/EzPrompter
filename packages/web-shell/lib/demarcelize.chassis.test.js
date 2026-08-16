import { describe, expect, it } from 'vitest';
import { buildChassisTransplantPrompt, CHASSIS_TRANSPLANT_SYSTEM } from './demarcelize.js';

describe('chassis transplant prompt contract', () => {
  it('keeps target identity authoritative and reference structure authoritative', () => {
    expect(CHASSIS_TRANSPLANT_SYSTEM).toContain('TARGET HTML is the sole authority for brand truth');
    expect(CHASSIS_TRANSPLANT_SYSTEM).toContain('REFERENCE HTML is the authority for the chassis');
    expect(CHASSIS_TRANSPLANT_SYSTEM).toContain('Never invent testimonials, prices, metrics');
    const prompt = buildChassisTransplantPrompt({ targetHtml: '<main>Flux</main>', referenceHtml: '<main>Farm</main>', transferContract: '# Contract' });
    expect(prompt).toContain('APPROVED CHASSIS TRANSFER CONTRACT:\n# Contract');
  });
});
