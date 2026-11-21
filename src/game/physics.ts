import Matter from 'matter-js';
import { PieceBlueprint } from '../types';

export function createMatterBodyFromBlueprint(
  bp: PieceBlueprint,
  x: number,
  y: number,
  angle: number = 0
): Matter.Body {
  const common = {
    friction: bp.friction,
    frictionStatic: bp.friction * 1.25,
    restitution: bp.restitution !== undefined ? bp.restitution : 0.04,
    density: bp.density,
    angle,
    plugin: { blueprint: bp },
  };

  if (bp.shape === 'circle') {
    return Matter.Bodies.circle(x, y, bp.r || 24, common);
  }
  if (bp.shape === 'trapezoid') {
    return Matter.Bodies.trapezoid(x, y, bp.w || 88, bp.h || 28, bp.slope || 0.25, common);
  }
  if (bp.shape === 'wedge') {
    const w = bp.w || 68;
    const h = bp.h || 36;
    const verts = [
      { x: -w / 2, y: h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: -h / 2 },
    ];
    return Matter.Bodies.fromVertices(x, y, [verts], common);
  }
  if (bp.shape === 'compoundL') {
    const w = bp.w || 76;
    const h = bp.h || 64;
    const thick = 22;
    const vertBar = Matter.Bodies.rectangle(x - w / 2 + thick / 2, y, thick, h, { render: { visible: false } });
    const horizBar = Matter.Bodies.rectangle(x, y + h / 2 - thick / 2, w, thick, { render: { visible: false } });
    const compound = Matter.Body.create({
      parts: [vertBar, horizBar],
      friction: bp.friction,
      frictionStatic: bp.friction * 1.25,
      restitution: 0.04,
      density: bp.density,
      plugin: { blueprint: bp },
    });
    Matter.Body.setPosition(compound, { x, y });
    Matter.Body.setAngle(compound, angle);
    return compound;
  }

  return Matter.Bodies.rectangle(x, y, bp.w || 80, bp.h || 24, common);
}

export function createFloatingRaft(
  width: number,
  waterBaseY: number,
  raftWidth: number
): { raftBody: Matter.Body; raftConstraint: Matter.Constraint } {
  const raftBody = Matter.Bodies.rectangle(width / 2, waterBaseY - 12, raftWidth, 22, {
    friction: 0.92,
    frictionStatic: 1.2,
    restitution: 0.02,
    density: 0.012,
    chamfer: { radius: 8 },
  });

  const raftConstraint = Matter.Constraint.create({
    pointA: { x: width / 2, y: waterBaseY - 12 },
    bodyB: raftBody,
    pointB: { x: 0, y: 0 },
    stiffness: 0.18,
    damping: 0.22,
    length: 0,
  });

  return { raftBody, raftConstraint };
}
