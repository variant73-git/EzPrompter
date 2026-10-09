import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CanonicalPrepOverlay from './CanonicalPrepOverlay.jsx';
import { canonicalErrorCopy } from '../lib/canonical/error-copy.js';

describe('CanonicalPrepOverlay', () => {
  it('mostra o número grande como barra de progresso acessível', () => {
    render(<CanonicalPrepOverlay prep={{ status: 'running', pct: 57.4 }} />);
    const bar = screen.getByRole('progressbar', { name: 'Preparing editable copy' });
    expect(bar).toHaveAttribute('aria-valuenow', '57');
    expect(bar).toHaveTextContent('57%');
  });

  it('falha mostra o motivo e as duas escolhas, sem arrastar o node', () => {
    const onRetry = vi.fn(); const onOpenLive = vi.fn(); const onParentDown = vi.fn();
    render(<div onMouseDown={onParentDown}><CanonicalPrepOverlay prep={{ status: 'failed', errorCode: 'timeout' }} onRetry={onRetry} onOpenLive={onOpenLive} /></div>);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't prepare the editable copy");
    expect(screen.getByRole('alert')).toHaveTextContent('This took longer than expected.');
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Try again' }));
    expect(onParentDown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open live clone instead' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenLive).toHaveBeenCalledTimes(1);
  });

  it('código desconhecido tem texto genérico; nada para mostrar sem estado', () => {
    expect(canonicalErrorCopy('qualquer').detail).toBe('Something went wrong while preparing it.');
    expect(canonicalErrorCopy('network')).toEqual({ title: 'Lost the connection', detail: 'The copy may already be ready. Try again to check.' });
    const { container } = render(<CanonicalPrepOverlay prep={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
