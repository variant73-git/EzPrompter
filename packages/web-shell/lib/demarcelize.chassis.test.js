import { describe, expect, it } from 'vitest';
import { buildChassisTransplantPrompt, CHASSIS_TRANSPLANT_SYSTEM } from './demarcelize.js';

describe('chassis transplant prompt contract', () => {
  it('keeps target identity authoritative and reference structure authoritative', () => {
    expect(CHASSIS_TRANSPLANT_SYSTEM).toContain('TARGET HTML is the sole authority for brand truth');
    expect(CHASSIS_TRANSPLANT_SYSTEM).toContain('REFERENCE HTML is the authority for the chassis');
    expect(CHASSIS_TRANSPLANT_SYSTEM).toContain('Never invent testimonials, prices, metrics');
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/curator comment[\s\S]*interpret it semantically/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/use other hero[\s\S]*keep a hero/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/merely recolouring[\s\S]*does not comply/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/read every curator comment in full/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/Do not use exact-phrase, keyword, substring/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/rationale, conditions, exceptions/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/bounded supporting reference/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/only when the contract explicitly says[\s\S]*selected implicitly/i);
    expect(CHASSIS_TRANSPLANT_SYSTEM).toMatch(/Never apply[\s\S]*direct reference supplied by the user/i);
    const prompt = buildChassisTransplantPrompt({ targetHtml: '<main>Flux</main>', referenceHtml: '<main>Farm</main>', transferContract: '# Contract' });
    expect(prompt).toContain('APPROVED CHASSIS TRANSFER CONTRACT:\n# Contract');
  });
});
