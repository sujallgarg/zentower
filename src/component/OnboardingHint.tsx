import React from 'react';

interface OnboardingHintProps {
  visible: boolean;
}

export const OnboardingHint: React.FC<OnboardingHintProps> = ({ visible }) => {
  return (
    <div
      className={`fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none text-center px-4 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="backdrop-blur-md bg-white/80 border border-black/10 rounded-2xl px-4 py-2.5 shadow-xs inline-block">
        <p className="text-xs sm:text-sm font-semibold text-stone-800">
          Tap anywhere or press <kbd className="px-1.5 py-0.5 bg-stone-200 rounded text-xs font-mono">SPACE</kbd> to drop
        </p>
        <p className="text-[11px] text-stone-500 mt-0.5">
          Balance all 20 pieces on the floating seesaw • <kbd className="px-1 bg-stone-200 rounded font-mono">R</kbd> to rotate
        </p>
      </div>
    </div>
  );
};
