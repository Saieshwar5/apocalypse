import * as THREE from 'three';
import type { NavGroup } from '../logic/flightDirector';
import { formatDistance } from '../logic/units';
import type { ScreenProjector } from './screenProjector';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SELECTED = '#e48cff';
const GROUP_COLOR: Record<NavGroup, string> = { job: '#8fd3ff', station: '#7dffb0', satellite: '#cfd8e6', pilot: '#ffb3a8', debris: '#ffb35c' };
/** Stations and pilots already carry their own names on the map. */
const NAMED_ELSEWHERE: readonly NavGroup[] = ['station', 'pilot'];
const LABEL_LENGTH = 26;

export interface MapTag {
  number: number;
  world: THREE.Vector3;
  label: string;
  group: NavGroup;
  selected: boolean;
}

export interface MapFrame {
  shipPosition: THREE.Vector3;
  planetRadius: number;
  /** The destinations in the list beside the map, numbered as the list numbers them. */
  tags: readonly MapTag[];
  /** The way to the current objective: points from the ship to where it ends, with its name. */
  route: { points: readonly THREE.Vector3[]; end: THREE.Vector3; color: string; label: string; zoneRadius: number | null } | null;
}

function shorten(text: string): string {
  return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text;
}

/**
 * The navigation layer of the tactical map: numbers beside everything in
 * the destination list, the route from the ship to the objective, and a
 * legend. Anything behind the planet from where the camera looks is left
 * out, so the map never draws through Earth.
 */
export function drawMap(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: MapFrame): void {
  context.save();
  const seen = (world: THREE.Vector3) => !projector.hiddenBehindSphere(world, frame.planetRadius);

  if (frame.route) {
    const { route } = frame;
    context.strokeStyle = route.color;
    context.fillStyle = route.color;
    context.lineWidth = 2;
    context.setLineDash([7, 6]);
    context.beginPath();
    let started = false;
    for (const world of [frame.shipPosition, ...route.points]) {
      const point = projector.project(world);
      if (point.depth < 1 || !seen(world)) {
        started = false;
        continue;
      }
      if (started) {
        context.lineTo(point.x, point.y);
      } else {
        context.moveTo(point.x, point.y);
        started = true;
      }
    }
    context.stroke();
    context.setLineDash([]);
    const end = projector.project(route.end);
    if (end.visible && seen(route.end)) {
      const ring = route.zoneRadius ? Math.max(12, projector.projectedRadius(route.zoneRadius, end.depth)) : 12;
      context.beginPath();
      context.arc(end.x, end.y, ring, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(end.x, end.y, 3, 0, Math.PI * 2);
      context.fill();
      context.font = `700 12px ${MONO}`;
      context.textAlign = 'center';
      const text = `${route.label} · ${formatDistance(route.end.distanceTo(frame.shipPosition))}`;
      const width = context.measureText(text).width + 12;
      context.fillStyle = 'rgba(4, 10, 18, 0.78)';
      context.fillRect(end.x - width / 2, end.y - ring - 24, width, 18);
      context.fillStyle = route.color;
      context.fillText(text, end.x, end.y - ring - 11);
      context.textAlign = 'left';
    }
  }

  context.font = `800 11px ${MONO}`;
  // Names already on screen: a new one that would land on top of them is left to its number.
  const named: { x: number; y: number }[] = [];
  const shown = frame.tags
    .map((tag) => ({ tag, point: projector.project(tag.world) }))
    .filter(({ tag, point }) => point.visible && seen(tag.world));
  for (const { tag, point } of shown) {
    if (NAMED_ELSEWHERE.includes(tag.group)) {
      named.push(point);
    }
  }
  for (const { tag, point } of shown) {
    const color = tag.selected ? SELECTED : GROUP_COLOR[tag.group];
    if (!NAMED_ELSEWHERE.includes(tag.group)) {
      const crowded = !tag.selected && named.some((other) => Math.abs(other.y - point.y) < 15 && Math.abs(other.x - point.x) < 190);
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(point.x, point.y - 6);
      context.lineTo(point.x + 6, point.y);
      context.lineTo(point.x, point.y + 6);
      context.lineTo(point.x - 6, point.y);
      context.closePath();
      context.stroke();
      if (!crowded) {
        context.fillStyle = color;
        context.fillText(shorten(tag.label), point.x + 11, point.y + 4);
        named.push(point);
      }
    }
    context.fillStyle = color;
    context.fillRect(point.x - 24, point.y - 8, 15, 15);
    context.fillStyle = '#060b12';
    context.fillText(String(tag.number), point.x - 20, point.y + 4);
  }

  drawLegend(context, projector);
  context.restore();
}

function drawLegend(context: CanvasRenderingContext2D, projector: ScreenProjector): void {
  const items: { mark: (x: number, y: number) => void; text: string }[] = [
    {
      text: 'you',
      mark: (x, y) => {
        context.strokeStyle = '#7dffb0';
        context.beginPath();
        context.arc(x, y, 5, 0, Math.PI * 2);
        context.stroke();
      },
    },
    {
      text: 'rock that will hit',
      mark: (x, y) => {
        context.strokeStyle = '#ff5a4a';
        context.strokeRect(x - 5, y - 5, 10, 10);
      },
    },
    {
      text: 'station',
      mark: (x, y) => {
        context.strokeStyle = '#7dffb0';
        context.strokeRect(x - 5, y - 5, 10, 10);
      },
    },
    {
      text: 'in the list',
      mark: (x, y) => {
        context.fillStyle = GROUP_COLOR.job;
        context.fillRect(x - 6, y - 6, 12, 12);
      },
    },
    {
      text: 'your route',
      mark: (x, y) => {
        context.strokeStyle = SELECTED;
        context.setLineDash([4, 3]);
        context.beginPath();
        context.moveTo(x - 8, y);
        context.lineTo(x + 8, y);
        context.stroke();
        context.setLineDash([]);
      },
    },
  ];
  context.font = `600 11px ${MONO}`;
  context.lineWidth = 1.5;
  const gap = 22;
  const widths = items.map((item) => 20 + context.measureText(item.text).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (items.length - 1);
  let x = projector.width / 2 - total / 2;
  const y = projector.height - 58;
  context.fillStyle = 'rgba(4, 10, 18, 0.72)';
  context.fillRect(x - 12, y - 12, total + 24, 24);
  items.forEach((item, index) => {
    item.mark(x + 8, y);
    context.fillStyle = '#b9c6da';
    context.fillText(item.text, x + 20, y + 4);
    x += widths[index] + gap;
  });
}
