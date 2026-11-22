import React from 'react';
import { PieceBlueprint, ThemeKey } from '../types';
import { NextPiecePreview } from './NextPiecePreview';

interface BottomDockProps {
  nextPiece: PieceBlueprint | null;
  theme: ThemeKey;
  onDrop: () => void;
  onRotate: () => void;
  onRestart: () => void;
}

export const BottomDock: React.FC<BottomDockProps> = ({
  nextPiece,
  theme,
  onDrop,
  onRotate,
  onRestart,
}) => {
  return (
    <footer className="fixed bottom-2 sm:bottom-4 left-0 right-0 z-20 pointer-events-none px-2 sm:px-4">
      <div className="max-w-md mx-auto flex items-center justify-between gap-1.5 sm:gap-2 pointer-events-auto backdrop-blur-md bg-white/80 border border-black/10 rounded-2xl sm:rounded-3xl p-1.5 sm:p-2 shadow-lg">
        {/* Next Piece Preview */}
        <NextPiecePreview blueprint={nextPiece} theme={theme} />

        {/* Action Buttons */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            onClick={onRotate}
            className="px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-stone-200/80 hover:bg-stone-300/80 active:scale-95 text-stone-900 font-semibold text-[11px] sm:text-xs flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer"
            title="Rotate 45° (R)"
          >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.36-5.36M20 15a9 9 0 01-15.36 5.36" />
            </svg>
            <span>Rotate</span>
          </button>

          <button
            onClick={onDrop}
            className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-stone-900 hover:bg-stone-800 active:scale-95 text-white font-semibold text-[11px] sm:text-xs shadow-xs transition-all cursor-pointer"
          >
            Drop
          </button>

          <button
            onClick={onRestart}
            aria-label="Restart Run"
            className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-stone-200/70 hover:bg-stone-300/80 active:scale-95 text-stone-700 transition-all cursor-pointer"
            title="Restart"
          >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
};
