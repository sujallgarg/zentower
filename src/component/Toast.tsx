import React from 'react';

interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-opacity duration-300 ${
        message ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="bg-stone-900 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg">
        {message}
      </div>
    </div>
  );
};
