import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { categoryLabel, subcategoryLabel } from '../categoryEmoji';
import { scopeChipColor, scopeSubColor } from '../groupColors';

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');

interface AlphabetScrubberProps {
  items: string[];
  activeItem: string | null;
  onSelect: (item: string | null) => void;
  isSubgroup?: boolean;
  parentGroup?: string;
  windowSize?: number;
  onActiveLettersChange?: (letters: string[]) => void;
}

export default function AlphabetScrubber({ items, activeItem, onSelect, isSubgroup = false, parentGroup = '', windowSize = 5, onActiveLettersChange }: AlphabetScrubberProps) {
  const [progress, setProgress] = useState(0);
  const [currentWindowSize, setCurrentWindowSize] = useState(windowSize);
  const trackRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // If there's an active item, initialize the window to show it
  useEffect(() => {
    if (activeItem) {
      const firstLetter = activeItem.charAt(0).toUpperCase();
      let idx = ALPHABET.indexOf(firstLetter);
      if (idx !== -1) {
        // center the window around this index
        let startIdx = idx - Math.floor(windowSize / 2);
        startIdx = Math.max(0, Math.min(26 - windowSize, startIdx));
        setProgress(startIdx / (26 - windowSize));
      }
    }
  }, [activeItem, windowSize]);

  // Reset window size when props change or window resizes
  useLayoutEffect(() => {
    setCurrentWindowSize(windowSize);
    const onResize = () => setCurrentWindowSize(windowSize);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [windowSize, progress, items]);

  // Auto-shrink if the chips wrap to a second line (height > 36px)
  useLayoutEffect(() => {
    if (chipsRef.current && currentWindowSize > 1) {
      if (chipsRef.current.scrollHeight > 36) {
        setCurrentWindowSize(s => Math.max(1, s - 1));
      }
    }
  });

  const handlePointer = (e: React.PointerEvent | PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let p = x / rect.width;
    p = Math.max(0, Math.min(1, p));
    setProgress(p);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handlePointer(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      handlePointer(e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const startIdx = Math.round(progress * (26 - currentWindowSize));
  const activeLetters = ALPHABET.slice(startIdx, startIdx + currentWindowSize);

  useEffect(() => {
    if (onActiveLettersChange) onActiveLettersChange(activeLetters);
  }, [startIdx, currentWindowSize]); // we use these dependencies because activeLetters is a new array every render

  const visibleItems = useMemo(() => {
    return items.filter(c => {
      const char = c.charAt(0).toUpperCase();
      if (!ALPHABET.includes(char)) return true;
      return activeLetters.includes(char);
    });
  }, [items, activeLetters]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', width: '100%' }}>
      
      {/* Alphabet Track */}
      <div 
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ 
          position: 'relative', 
          display: 'flex', 
          width: '100%', 
          height: '22px',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '4px',
          border: '1px solid var(--border-color)',
          userSelect: 'none',
          cursor: 'ew-resize',
          touchAction: 'none'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', height: '100%', padding: '0 6px', zIndex: 2 }}>
          {ALPHABET.map(l => (
            <span key={l} style={{ 
              fontSize: '0.7rem', 
              color: activeLetters.includes(l) ? '#000' : 'var(--text-secondary)',
              fontWeight: activeLetters.includes(l) ? 'bold' : 'normal',
              transition: 'color 0.1s'
            }}>
              {l}
            </span>
          ))}
        </div>
        
        {/* The Sliding Window */}
        <div style={{ 
          position: 'absolute', 
          top: 0, 
          bottom: 0,
          left: `${(startIdx / 26) * 100}%`, 
          width: `${(currentWindowSize / 26) * 100}%`,
          background: 'var(--accent-primary)',
          borderRadius: '2px',
          boxShadow: '0 0 10px rgba(255,165,0,0.5)',
          pointerEvents: 'none',
          zIndex: 1,
          transition: isDragging.current ? 'none' : 'left 0.1s ease-out'
        }} />
      </div>

      {/* The Chips inside the window */}
      <div ref={chipsRef} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', height: '28px', overflow: 'hidden', alignItems: 'center' }}>
        <button
          onClick={() => onSelect(null)}
          className={`btn ${!activeItem ? 'primary' : 'secondary'}`}
          style={{ 
            padding: '0.1rem 0.5rem', 
            fontSize: '0.75rem',
            opacity: !activeItem ? 1 : 0.6,
            cursor: 'pointer'
          }}
        >
          All
        </button>
        {visibleItems.map(c => {
          const color = isSubgroup ? scopeSubColor(parentGroup, c) : scopeChipColor(c);
          const label = isSubgroup ? subcategoryLabel(parentGroup, c) : categoryLabel(c);
          const active = activeItem === c;
          
          return (
            <button
              key={c}
              onClick={() => onSelect(active ? null : c)}
              className={`btn ${active ? 'primary' : 'secondary'}`}
              style={{
                padding: '0.1rem 0.5rem', 
                fontSize: '0.75rem', 
                borderLeft: color ? `3px solid ${color}` : undefined,
                opacity: active ? 1 : 0.8,
                cursor: 'pointer',
                animation: 'fadeIn 0.2s ease-out'
              }}
            >
              {label}
            </button>
          );
        })}
        {visibleItems.length === 0 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            No {isSubgroup ? 'sub' : ''}categories in this range
          </span>
        )}
      </div>

    </div>
  );
}
