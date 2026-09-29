import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ShortcutKey from './ShortcutKey.jsx';

describe('ShortcutKey', () => {
  it('rende a tecla como <kbd>, que é o elemento semântico de teclado', () => {
    const { container } = render(<ShortcutKey>L</ShortcutKey>);
    const teclas = container.querySelectorAll('kbd');
    expect(teclas).toHaveLength(1);
    expect(teclas[0].textContent).toBe('L');
  });

  it('uma combinação vira um quadrado POR tecla', () => {
    const { container } = render(<ShortcutKey keys={['⌘', 'Z']} />);
    expect([...container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘', 'Z']);
  });

  it('sem tecla não rende nada — nunca um quadrado vazio', () => {
    const { container } = render(<ShortcutKey />);
    expect(container.firstChild).toBeNull();
    expect(render(<ShortcutKey keys={[]} />).container.firstChild).toBeNull();
  });

  it('aceita classe de fora sem perder a própria', () => {
    const { container } = render(<ShortcutKey className="extra">L</ShortcutKey>);
    expect(container.firstChild.className).toContain('extra');
    expect(container.firstChild.className.split(' ').length).toBeGreaterThan(1);
  });
});
