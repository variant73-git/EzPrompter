import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InteractionSwitches from './InteractionSwitches.jsx';

const abrir = () => fireEvent.click(screen.getByRole('button', { name: 'Clone interaction' }));

describe('InteractionSwitches', () => {
  it('parte do padrão do dono: links DESLIGADOS, hover ligado', () => {
    render(<InteractionSwitches interaction={{ links: false, hover: true }} onChange={vi.fn()} />);
    abrir();
    expect(screen.getByRole('checkbox', { name: /Follow links/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hover effects/ })).toBeChecked();
  });

  it('mostra o texto acordado e o atalho como TECLA, pela convenção', () => {
    const { container } = render(<InteractionSwitches interaction={{ links: false, hover: true }} onChange={vi.fn()} />);
    abrir();
    expect(screen.getByText('While on, clicking a link opens it instead of selecting')).toBeInTheDocument();
    // A convenção é `<kbd>`, não texto solto — e a tecla é a que o bridge usa.
    const teclas = [...container.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(teclas).toContain('L');
  });

  it('manda só o campo tocado, nunca o par inteiro', () => {
    const onChange = vi.fn();
    render(<InteractionSwitches interaction={{ links: false, hover: true }} onChange={onChange} />);
    abrir();
    fireEvent.click(screen.getByRole('checkbox', { name: /Follow links/ }));
    expect(onChange).toHaveBeenCalledWith({ links: true });
    onChange.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hover effects/ }));
    expect(onChange).toHaveBeenCalledWith({ hover: false });
  });

  // ⚠️ Segurar a tecla liga a navegação DE FATO, mas não é o valor salvo: o botão
  // reflete o efetivo (para o estado ser visível sem abrir) e a caixa reflete só ela
  // mesma. Se a caixa seguisse a tecla, ela mentiria sobre o que está guardado.
  it('a tecla segurada acende o botão sem marcar a caixa', () => {
    render(<InteractionSwitches interaction={{ links: false, hover: true }} linksHold onChange={vi.fn()} />);
    const botao = screen.getByRole('button', { name: 'Clone interaction' });
    expect(botao).toHaveAttribute('aria-pressed', 'true');
    abrir();
    expect(screen.getByRole('checkbox', { name: /Follow links/ })).not.toBeChecked();
  });

  it('fecha no Escape', () => {
    render(<InteractionSwitches interaction={{ links: false, hover: true }} onChange={vi.fn()} />);
    abrir();
    expect(screen.getByRole('checkbox', { name: /Follow links/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('checkbox', { name: /Follow links/ })).not.toBeInTheDocument();
  });
});
