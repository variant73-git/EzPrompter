import { describe, expect, it } from 'vitest';
import {
  MOTION_EDITOR_DEVICE_ORDER,
  MOTION_EDITOR_DEVICES,
  getMotionEditorDevice,
} from './devices.js';

describe('native motion editor devices', () => {
  it('uses the canvas editing dimensions as the shared canonical configuration', () => {
    expect(MOTION_EDITOR_DEVICE_ORDER).toEqual(['desktop', 'tablet', 'mobile']);
    expect(MOTION_EDITOR_DEVICES).toEqual({
      desktop: { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
      tablet: { id: 'tablet', label: 'Tablet', width: 768, height: 920 },
      mobile: { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
    });
  });

  it('returns desktop for an unknown device without mutating the shared values', () => {
    expect(getMotionEditorDevice('watch')).toBe(MOTION_EDITOR_DEVICES.desktop);
    expect(() => { MOTION_EDITOR_DEVICES.desktop.width = 1; }).toThrow();
    expect(getMotionEditorDevice('desktop').width).toBe(1280);
  });
});
