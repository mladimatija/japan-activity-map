import { useEffect, useState } from 'react';

/**
 * The width an element is drawn at, kept up to date as the pane is resized: pass the setter as
 * the element's `ref`. Zero until it has been measured.
 */
export const useWidth = () => {
  const [node, setNode] = useState<Element | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry?.contentRect.width ?? 0)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width] as const;
};
