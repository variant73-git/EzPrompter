'use client';

import { useEffect, useState } from 'react';
import { TimelinePanel } from './NativeMotionEditor.jsx';
import styles from './native-motion-canvas.module.css';

const TIMELINE_HEIGHT = 166;
const LABELS_WIDTH = 152;

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
  const selectedRowId = controller?.selectedRowId || null;

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
        bodyHeight={TIMELINE_HEIGHT}
        onBodyHeight={() => {}}
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
      />
    </div>
  );
}
