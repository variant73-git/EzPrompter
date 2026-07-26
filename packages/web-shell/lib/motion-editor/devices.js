const desktop = Object.freeze({ id: 'desktop', label: 'Desktop', width: 1280, height: 800 });
const tablet = Object.freeze({ id: 'tablet', label: 'Tablet', width: 768, height: 920 });
const mobile = Object.freeze({ id: 'mobile', label: 'Mobile', width: 390, height: 844 });

export const MOTION_EDITOR_DEVICE_ORDER = Object.freeze(['desktop', 'tablet', 'mobile']);

export const MOTION_EDITOR_DEVICES = Object.freeze({ desktop, tablet, mobile });

export function getMotionEditorDevice(deviceId) {
  return MOTION_EDITOR_DEVICES[deviceId] || MOTION_EDITOR_DEVICES.desktop;
}
