import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferencePlanner from './ReferencePlanner.jsx';

function option(id, title, composition = {}) {
  return {
    id,
    title,
    url: `https://${id}.example`,
    thumbnailUrl: '',
    sourceNames: ['Landbook'],
    influence: 'chassis',
    score: 100,
    scoreBreakdown: { typeFit: 100 },
    owns: 'section order, wireframe geometry, text composition, media roles, animation logic, and responsive structure',
    reasons: ['site type: landing-page'],
    composition: {
      preserve: composition.preserve || ['alignment and anchoring logic'],
      adapt: composition.adapt || ['copy length to the chassis capacity'],
      replace: composition.replace || ['brand identity'],
    },
  };
}

function preview(options, overrides = {}) {
  return {
    schemaVersion: 3,
    plannerContractVersion: 5,
    mode: 'preview',
    strategy: 'single-chassis',
    selectionMode: 'curated-keeps',
    scoringBasis: 'site-type-only',
    generationTriggered: false,
    rule: 'One approved chassis owns the wireframe; design system, content, and imagery are replaced.',
    options,
    optionOffset: 0,
    pageSize: 3,
    totalOptions: options.length,
    hasPrevious: false,
    hasMore: false,
    previewHash: 'a'.repeat(64),
    warnings: [],
    ...overrides,
  };
}

function approvedRecord(reference) {
  const { composition, ...selectedReference } = reference;
  return {
    id: 'plan_one',
    status: 'approved',
    plan: {
      rule: 'One approved chassis owns the wireframe; design system, content, and imagery are replaced.',
      scoringBasis: 'site-type-only',
      selectedReferences: [selectedReference],
      composition,
    },
  };
}

describe('ReferencePlanner', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps equal-fit options ephemeral until one chassis is explicitly approved', async () => {
    const user = userEvent.setup();
    const alpha = option('alpha', 'Alpha');
    const bravo = option('bravo', 'Bravo', { preserve: ['Bravo section rhythm'] });
    const previewPayload = preview([alpha, bravo]);
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: previewPayload }) })
      .mockResolvedValueOnce({ ok: true, json: async () => approvedRecord(bravo) });

    render(<ReferencePlanner reviewStats={{ keep: 13 }} />);
    expect(screen.getByText('13 kept chassis available')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Website brief'), 'An industrial landing page for operations leaders.');
    await user.click(screen.getByRole('button', { name: 'Build chassis preview' }));

    expect(await screen.findByText('Not saved')).toBeInTheDocument();
    expect(screen.getByText('1–2 of 2 equally fitting options')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Alpha/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Approve recipe' })).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/references/plan/preview', expect.objectContaining({ method: 'POST' }));

    await user.click(screen.getByRole('radio', { name: /Bravo/ }));
    expect(screen.getByText('Bravo section rhythm')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve recipe' }));

    await waitFor(() => expect(screen.getByText('approved')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Analyze structure' })).toBeInTheDocument();
    const [, approvalOptions] = global.fetch.mock.calls[1];
    expect(JSON.parse(approvalOptions.body)).toMatchObject({
      selectedReferenceId: 'bravo', previewHash: previewPayload.previewHash, optionOffset: 0,
    });
  });

  it('previews a direct URL as one automatically selected option', async () => {
    const user = userEvent.setup();
    const direct = option('manual_one', 'reference.example');
    const directPreview = preview([direct], { selectionMode: 'direct-url', scoringBasis: 'direct-reference' });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ preview: directPreview }) });

    render(<ReferencePlanner reviewStats={{ keep: 0 }} />);
    await user.click(screen.getByRole('button', { name: 'Direct URL' }));
    await user.type(screen.getByLabelText('Reference URL'), 'https://reference.example');
    await user.type(screen.getByLabelText('Website brief'), 'Uma landing page para uma empresa industrial.');
    await user.click(screen.getByRole('button', { name: 'Build chassis preview' }));

    expect(await screen.findByText('One type-fit option')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /reference.example/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Approve recipe' })).toBeEnabled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      brief: 'Uma landing page para uma empresa industrial.', referenceUrl: 'https://reference.example', optionOffset: 0,
    });
  });

  it('pages through neutral tie groups and discards without persisting', async () => {
    const user = userEvent.setup();
    const first = preview([option('alpha', 'Alpha'), option('bravo', 'Bravo'), option('delta', 'Delta')], { totalOptions: 4, hasMore: true });
    const second = preview([option('zulu', 'Zulu')], { optionOffset: 3, totalOptions: 4, hasPrevious: true, previewHash: 'b'.repeat(64) });
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: first }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: second }) });

    render(<ReferencePlanner reviewStats={{ keep: 4 }} />);
    await user.type(screen.getByLabelText('Website brief'), 'A landing page for an industrial company.');
    await user.click(screen.getByRole('button', { name: 'Build chassis preview' }));
    await user.click(await screen.findByRole('button', { name: 'More chassis options' }));

    expect(await screen.findByText('Zulu')).toBeInTheDocument();
    expect(screen.getByText('4–4 of 4 equally fitting options')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Zulu/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Approve recipe' })).toBeDisabled();
    const [, pagingOptions] = global.fetch.mock.calls[1];
    expect(JSON.parse(pagingOptions.body)).toMatchObject({ optionOffset: 3 });

    await user.click(screen.getByRole('button', { name: 'Discard preview' }));
    expect(screen.getByText('Compare equal-fit options before anything is saved.')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps structural capture behind the persisted approval', async () => {
    const user = userEvent.setup();
    const only = option('only', 'Only');
    const manifest = {
      hash: 'abcdef1234567890', evidence: { confidence: 'high', gaps: [] },
      structure: { sections: [{ id: 'hero', role: 'hero' }, { id: 'work', role: 'showcase' }] },
      media: { slots: [{ id: 'hero-media' }] }, motion: { tracks: [{ id: 'hero-reveal' }] },
      responsive: { compared: true, score: 100 },
    };
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: preview([only]) }) })
      .mockResolvedValueOnce({ ok: true, json: async () => approvedRecord(only) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ manifest, cached: false }) });

    render(<ReferencePlanner reviewStats={{ keep: 1 }} />);
    await user.type(screen.getByLabelText('Website brief'), 'A landing page for an industrial company.');
    await user.click(screen.getByRole('button', { name: 'Build chassis preview' }));
    expect(screen.queryByRole('button', { name: 'Analyze structure' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Approve recipe' }));
    await user.click(await screen.findByRole('button', { name: 'Analyze structure' }));
    expect(await screen.findByLabelText('Chassis manifest')).toBeInTheDocument();
    expect(screen.getByText(/Generation remains locked until the transplant contract is reviewed\./)).toBeInTheDocument();
  });
});
