'use client';

import { useEffect, useState } from 'react';
import { TimelinePanel } from './NativeMotionEditor.jsx';
import styles from './native-motion-canvas.module.css';

const TIMELINE_HEIGHT = 166;
const LABELS_WIDTH = 152;
// Header row height (css .timelineHeader). The dock's total height is
// header + body when open, header alone when collapsed — so the collapse
// control folds the WHOLE dock, not just the tracks inside a fixed box.
const TIMELINE_HEADER = 34;
// Resize bounds (product spec 2026-08-17): max 45% of the viewport height,
// min just enough for the ruler + one track.
const MIN_BODY_HEIGHT = 62;
function maxBodyHeight() {
  if (typeof window === 'undefined') return 320;
  return Math.max(MIN_BODY_HEIGHT, Math.round(window.innerHeight * 0.45) - TIMELINE_HEADER);
}

export function hasNativeMotionContext(controller) {
  return Boolean(
    controller?.activeMotion
    || controller?.motion?.length
    || controller?.viewportRows?.length,
  );
}

export default function NativeMotionTimelineDock({ controller, open = true, onOpenChange }) {
  const [zoom, setZoom] = useState(1);
  const [expandedLayers, setExpandedLayers] = useState(() => new Set());
  const [labelsWidth, setLabelsWidth] = useState(LABELS_WIDTH);
  const [bodyHeight, setBodyHeight] = useState(TIMELINE_HEIGHT);
  const selectedRowId = controller?.selectedRowId || null;
  const clampedBody = Math.max(MIN_BODY_HEIGHT, Math.min(maxBodyHeight(), bodyHeight));
  const dockHeight = open ? clampedBody + TIMELINE_HEADER : TIMELINE_HEADER;

  // The dock owns --native-motion-timeline-h while mounted: the edit viewport
  // reserves this space, so collapse/resize must move BOTH together. Removing
  // on unmount falls back to the CSS default.
  useEffect(() => {
    document.body.style.setProperty('--native-motion-timeline-h', `${dockHeight}px`);
    return () => document.body.style.removeProperty('--native-motion-timeline-h');
  }, [dockHeight]);

  // Re-clamp when the window shrinks (the 45% ceiling follows the viewport).
  useEffect(() => {
    const onResize = () => setBodyHeight((h) => Math.max(MIN_BODY_HEIGHT, Math.min(maxBodyHeight(), h)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!selectedRowId) return;
    setExpandedLayers((current) => {
      if (current.has(selectedRowId)) return current;
      const next = new Set(current);
      next.add(selectedRowId);
      return next;
    });
  }, [selectedRowId]);

  if (!hasNativeMotionContext(controller)) return null;

  return (
    <div
      className={styles.timelineDock}
      role="region"
      aria-label="Motion timeline"
      data-dock="bottom"
      data-reserves-side-panels="true"
      data-native-motion-chrome="true"
      style={{ height: dockHeight }}
    >
      <TimelinePanel
        open={open}
        rows={controller.viewportRows || []}
        detailByRow={controller.motionDetail || {}}
        expandedLayers={expandedLayers}
        onToggleLayer={(elementId) => {
          const expanding = !expandedLayers.has(elementId);
          setExpandedLayers((current) => {
            const next = new Set(current);
            if (next.has(elementId)) next.delete(elementId);
            else next.add(elementId);
            return next;
          });
          if (expanding && !controller.motionDetail?.[elementId] && controller.status === 'ready') {
            controller.commands.describeElement(elementId);
          }
        }}
        activeMotionId={controller.activeMotionId}
        onActiveMotion={controller.commands.selectMotion}
        selectedElementId={selectedRowId}
        onSelectElement={controller.commands.focusElement}
        labelsWidth={labelsWidth}
        onLabelsWidth={setLabelsWidth}
        bodyHeight={clampedBody}
        onBodyHeight={(h) => setBodyHeight(Math.max(MIN_BODY_HEIGHT, Math.min(maxBodyHeight(), h)))}
        minBodyHeight={MIN_BODY_HEIGHT}
        maxBodyHeight={maxBodyHeight()}
        page={controller.viewportPage}
        onScrollTo={controller.commands.scrollTo}
        onScrubIntro={controller.commands.scrubIntro}
        onScrubStart={controller.commands.beginScrub}
        onScrubEnd={controller.commands.endScrub}
        onUnlink={controller.commands.unlinkMotion}
        onStripEdit={controller.commands.applyStripEdit}
        motion={controller.activeMotion}
        state={controller.timelineState}
        speed={controller.speed}
        zoom={zoom}
        autoKeyframe={controller.autoKeyframe}
        selectedKeyframe={controller.selectedKeyframe}
        onToggle={() => onOpenChange?.(!open)}
        onPlayback={controller.commands.playback}
        onSpeed={controller.commands.changeSpeed}
        onSeek={controller.commands.seekMotion}
        onZoom={setZoom}
        onPlaybackMode={controller.commands.changePlaybackMode}
        onAutoKeyframe={controller.commands.toggleAutoKeyframe}
        onSelectKeyframe={controller.commands.selectKeyframe}
        onMoveKeyframe={controller.commands.moveKeyframe}
        onDuplicateKeyframe={controller.commands.duplicateKeyframe}
        onDeleteKeyframe={controller.commands.deleteKeyframe}
        onChangeKeyframeEasing={controller.commands.changeKeyframeEasing}
        onChangeKeyframeValue={controller.commands.changeKeyframeValue}
        onChangeStepValue={controller.commands.changeStepValue}
      />
    </div>
  );
}
