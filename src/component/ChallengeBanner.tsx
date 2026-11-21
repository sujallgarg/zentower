import React from 'react';

interface ChallengeBannerProps {
  day: number;
  height: number;
  onDismiss: () => void;
}

export const ChallengeBanner: React.FC<ChallengeBannerProps> = ({ day, height, onDismiss }) => {
  return (
    <div className="max-w-md mx-auto mt-2.5 pointer-events-auto backdrop-blur-md bg-amber-50/95 border border-amber-300 text-amber-950 rounded-2xl px-3.5 py-2 text-xs font-medium flex items-center justify-between shadow-xs">
      <span>
        Challenge: Beat <strong className="font-mono">{height.toFixed(1)}m</strong> on Daily Seed <strong className="font-mono">#{day}</strong>!
      </span>
      <button
        onClick={onDismiss}
        className="ml-2 text-amber-700 hover:text-amber-950 font-bold cursor-pointer"
        aria-label="Dismiss challenge banner"
      >
        ✕
      </button>
    </div>
  );
};
