import { createHash } from 'node:crypto';
import { renderTransplantInstructions } from './chassis-transplant.js';

function contractHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function baseContract(contract) {
  const copy = { ...contract, generationAuthorized: false, creditSpendAuthorized: false };
  delete copy.contractHash;
  delete copy.approvedAt;
  return copy;
}

export function prepareChassisGeneration({ blueprint, targetHtml, referenceHtml } = {}) {
  if (!blueprint?.manifestHash || !blueprint?.sections?.length) throw new Error('invalid_transplant_blueprint');
  if (!String(targetHtml || '').trim()) throw new Error('target_html_required');
  if (!String(referenceHtml || '').trim()) throw new Error('reference_html_required');
  const prepared = {
    schemaVersion: 1,
    engine: 'chassis-transplant-v1',
    manifestHash: blueprint.manifestHash,
    targetBrand: blueprint.target.brand,
    instructions: renderTransplantInstructions(blueprint),
    targetHtml,
    referenceHtml,
    generationAuthorized: false,
    creditSpendAuthorized: false,
  };
  return { ...prepared, contractHash: contractHash(prepared) };
}

export function authorizeChassisGeneration(prepared, approval = {}) {
  if (!prepared?.contractHash || prepared.contractHash !== contractHash(baseContract(prepared))) {
    throw new Error('generation_contract_tampered');
  }
  if (approval.manifestHash !== prepared.manifestHash || approval.contractHash !== prepared.contractHash) throw new Error('generation_approval_mismatch');
  return { ...prepared, generationAuthorized: true, creditSpendAuthorized: Boolean(approval.creditSpendAuthorized), approvedAt: approval.approvedAt || new Date().toISOString() };
}

export function buildDemarcelizerPayload(contract) {
  if (!contract?.generationAuthorized) throw new Error('generation_not_authorized');
  if (contract.contractHash !== contractHash(baseContract(contract))) throw new Error('generation_contract_tampered');
  return {
    targetHtml: contract.targetHtml,
    referenceHtml: contract.referenceHtml,
    transferContract: contract.instructions,
    manifestHash: contract.manifestHash,
  };
}
