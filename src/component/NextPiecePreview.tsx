import React, { useEffect, useRef } from 'react';
import { PieceBlueprint, ThemeKey } from '../types';
import { THEMES } from '../style/themes';

interface NextPiecePreviewProps {
  blueprint: PieceBlueprint | null;
  theme: ThemeKey;
}

export const NextPiecePreview: React.FC<NextPiecePreviewProps> = ({ blueprint, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 44 * dpr;
    canvas.height = 44 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, 44, 44);
    if (!blueprint) return;

    const currentTheme = THEMES[theme] || THEMES.oak;
    const pal = currentTheme.palette[blueprint.paletteIdx] || currentTheme.palette[0];

    ctx.save();
    ctx.translate(22, 22);
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = 2;

    if (blueprint.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (blueprint.shape === 'compoundL') {
      ctx.beginPath();
      ctx.rect(-11, -12, 8, 24);
      ctx.rect(-11, 4, 22, 8);
      ctx.fill();
      ctx.stroke();
    } else if (blueprint.shape === 'wedge') {
      ctx.beginPath();
      ctx.moveTo(-11, 10);
      ctx.lineTo(11, 10);
      ctx.lineTo(-11, -10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (blueprint.shape === 'trapezoid') {
      ctx.beginPath();
      ctx.moveTo(-7, -8);
      ctx.lineTo(7, -8);
      ctx.lineTo(12, 8);
      ctx.lineTo(-12, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const scale = Math.min(28 / (blueprint.w || 60), 22 / (blueprint.h || 24));
      const rw = (blueprint.w || 60) * scale;
      const rh = (blueprint.h || 24) * scale;
      ctx.beginPath();
      ctx.roundRect(-rw / 2, -rh / 2, rw, rh, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }, [blueprint, theme]);

  return (
    <div className="flex items-center gap-2 pl-2">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-500 leading-tight">
        Next<br />Piece
      </div>
      <canvas
        ref={canvasRef}
        width={44}
        height={44}
        className="w-11 h-11 rounded-2xl bg-stone-200/70 border border-black/5"
      />
    </div>
  );
};
