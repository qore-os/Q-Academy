"use client";

import { useCallback, useRef, useState, type DragEventHandler } from "react";

type FileDropOptions = {
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: readonly File[]) => void;
};

function hasFilePayload(types: readonly string[]) {
  return types.includes("Files");
}

export function useFileDrop({
  disabled = false,
  multiple = false,
  onFiles,
}: FileDropOptions) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepth = useRef(0);

  const resetDragState = useCallback(() => {
    dragDepth.current = 0;
    setIsDraggingFiles(false);
  }, []);

  const onDragEnter = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!hasFilePayload(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      dragDepth.current += 1;
      if (!disabled) setIsDraggingFiles(true);
    },
    [disabled],
  );

  const onDragOver = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!hasFilePayload(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback<DragEventHandler<HTMLElement>>((event) => {
    if (!hasFilePayload(Array.from(event.dataTransfer.types))) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFiles(false);
  }, []);

  const onDrop = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!hasFilePayload(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      resetDragState();
      if (disabled) return;
      const files = Array.from(event.dataTransfer.files);
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [disabled, multiple, onFiles, resetDragState],
  );

  return {
    isDraggingFiles: isDraggingFiles && !disabled,
    fileDropProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    resetDragState,
  };
}
