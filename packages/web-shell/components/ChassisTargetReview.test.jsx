import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChassisTargetReview from './ChassisTargetReview.jsx';

function contract(overrides = {}) {
  return {
    schemaVersion: 2,
    manifestHash: 'm'.repeat(64),
    hash: 'c'.repeat(64),
    status: 'preview',
    target: {
      brand: 'Amigo Secreto',
      authority: { type: 'url', url: 'https://target.example/', label: 'target.example' },
      intent: 'Make this old site feel current and trustworthy.', notes: '',
      readiness: { content: true, designSystem: true, media: true },
    },
    targetEvidence: {
      hash: 'e'.repeat(64), sourceUrl: 'https://target.example/', brand: 'Amigo Secreto',
      title: 'Amigo Secreto, o site oficial', description: 'Create a group and invite friends.', language: 'pt-BR',
      headings: ['Now without paper'], callsToAction: ['Start a group'],
      colors: ['#D9382E', '#F7F1E8'], fonts: ['Archivo'], logos: [],
      counts: { sections: 3, visibleCharacters: 480, media: 0 },
    },
    strategy: {
      hypotheses: [{ id: 'modernize', conclusion: 'Modernize the reading, not the product identity.', because: ['The target is the semantic authority.', 'The prompt asks for improvement.'] }],
      questions: [{
        id: 'identityDistance', label: 'How far should the refresh move from the current identity?',
        why: 'This controls how much of the detected identity changes.', recommended: 'evolve', selected: 'evolve',
        options: [
          { id: 'evolve', label: 'Evolve it', description: 'Keep recognition, reinterpret the system.' },
          { id: 'preserve', label: 'Stay familiar', description: 'Retain the current identity.' },
          { id: 'reinvent', label: 'Reimagine it', description: 'Establish a new visual identity.' },
        ],
      }],
      selected: { identityDistance: 'evolve' },
      suggestions: [{ id: 'color', label: 'Color strategy', proposal: 'Evolve the inherited hue.', because: 'Recognition remains intact.' }],
      mediaPlan: { mode: 'original-people', status: 'planned', label: 'Original people will be sourced during execution.' },
      referenceBoundary: { rule: 'The selected bank reference supplies the chassis only. Target truth supplies identity.' },
    },
    blueprint: {
      directives: { preserve: ['section order'], adapt: ['copy capacity'], replace: ['reference identity'] },
      acceptance: { generationAuthorized: false },
    },
    guidance: { worthBorrowing: 'Hero pacing.', avoid: 'Reference identity.' },
    ledger: [{
      id: 'hero', role: 'hero', order: 1,
      capacity: { headingCharacters: 24, bodyCharacters: 80, visibleCharacters: 104 },
      mediaBindings: [{ id: 'hero-media', role: 'hero-background', status: 'planned-original' }],
      motionPortability: [{ id: 'hero-reveal', driver: 'scroll', portable: true, reason: 'Semantic driver can be retained.' }],
    }],
    summary: { sections: 1, mediaSlots: 1, motionTracks: 1 },
    gaps: [], approvable: true,
    locks: { generationAuthorized: false, creditSpendAuthorized: false, canvasMutationAuthorized: false },
    ...overrides,
  };
}

describe('ChassisTargetReview', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts from a short prompt, presents an inferred strategy, and approves exact choices', async () => {
    const user = userEvent.setup();
    const initial = contract();
    const changed = contract({
      hash: 'r'.repeat(64),
      strategy: {
        ...initial.strategy,
        selected: { identityDistance: 'reinvent' },
        questions: initial.strategy.questions.map((question) => ({ ...question, selected: 'reinvent' })),
      },
    });
    const approved = { ...changed, status: 'approved', approvedAt: '2026-08-12T12:00:00.000Z' };
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contract: initial }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contract: changed }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contract: approved }) });

    render(<ChassisTargetReview planId="plan_1" manifestHash={'m'.repeat(64)} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('What should improve?'), 'Make this old site feel current and trustworthy.');
    await user.type(screen.getByLabelText('Target site'), 'https://target.example');
    await user.click(screen.getByRole('button', { name: 'Build proposed direction' }));

    expect(await screen.findByText('A strategy, not a questionnaire.')).toBeInTheDocument();
    expect(screen.getByText('Modernize the reading, not the product identity.')).toBeInTheDocument();
    expect(screen.getByText('The selected bank reference supplies the chassis only. Target truth supplies identity.')).toBeInTheDocument();
    expect(screen.getByText('480 visible characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Evolve it/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /Reimagine it/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Reimagine it/ })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(screen.getByRole('button', { name: 'Approve strategy and contract' }));
    expect(await screen.findByRole('button', { name: 'Strategy approved' })).toBeDisabled();

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const [, approvalOptions] = global.fetch.mock.calls[2];
    expect(JSON.parse(approvalOptions.body)).toMatchObject({
      contractHash: changed.hash,
      target: {
        authorityType: 'url', url: 'https://target.example',
        intent: 'Make this old site feel current and trustworthy.',
        strategySelections: { identityDistance: 'reinvent' },
      },
    });
  });

  it('invalidates a persisted approval as soon as the short prompt changes', async () => {
    const user = userEvent.setup();
    render(<ChassisTargetReview planId="plan_1" manifestHash={'m'.repeat(64)} initialContract={{ ...contract(), status: 'approved' }} />);
    expect(screen.getByRole('button', { name: 'Strategy approved' })).toBeDisabled();
    await user.type(screen.getByLabelText('What should improve?'), ' More playful.');
    expect(screen.queryByRole('button', { name: 'Strategy approved' })).not.toBeInTheDocument();
    expect(screen.getByText('Inputs changed. The previous approval no longer matches this strategy.')).toBeInTheDocument();
  });

  it('does not revive an earlier contract schema or a changed Manifest', () => {
    render(<ChassisTargetReview
      planId="plan_1"
      manifestHash={'n'.repeat(64)}
      initialContract={{ ...contract(), schemaVersion: 1, status: 'approved' }}
    />);
    expect(screen.queryByRole('button', { name: 'Strategy approved' })).not.toBeInTheDocument();
    expect(screen.getByText('Saved approval uses an earlier target-contract version or no longer matches the current authority. Review a fresh strategy.')).toBeInTheDocument();
  });
});
