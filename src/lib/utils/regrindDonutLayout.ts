export type RegrindDonutItem = { label: string; value: number; color: string };
type Point = { x: number; y: number };

const sampleCurve = (start: Point, first: Point, second: Point, end: Point) => Array.from({ length: 25 }, (_, index) => {
  const t = index / 24;
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u * u * t * first.x + 3 * u * t * t * second.x + t ** 3 * end.x,
    y: u ** 3 * start.y + 3 * u * u * t * first.y + 3 * u * t * t * second.y + t ** 3 * end.y
  };
});

const leadersCross = (leaders: Point[][]) => {
  const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let first = 0; first < leaders.length; first++) {
    for (let second = first + 1; second < leaders.length; second++) {
      const a = leaders[first];
      const b = leaders[second];
      for (let i = 1; i < a.length; i++) {
        for (let j = 1; j < b.length; j++) {
          if (orientation(a[i - 1], a[i], b[j - 1]) * orientation(a[i - 1], a[i], b[j]) < 0
            && orientation(b[j - 1], b[j], a[i - 1]) * orientation(b[j - 1], b[j], a[i]) < 0) return true;
        }
      }
    }
  }
  return false;
};

export const regrindDonutLayout = (
  items: RegrindDonutItem[],
  containerWidth: number,
  measurements: { heights?: number[]; nameHeights?: number[]; angles?: number[] } = {}
) => {
  const width = Math.max(220, Number.isFinite(containerWidth) ? containerWidth : 1200);
  const compact = width < 900;
  const labelWidth = compact ? width - 56 : Math.min(270, width * 0.22);
  const radius = compact ? Math.min(150, (width - 56) / 2) : Math.min(210, (width - 48 - 2 * labelWidth - 144) / 2);
  const valid = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = valid.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;
  const callouts = valid.map((item, index) => {
    const degrees = measurements.angles?.[index] ?? 90 - (cumulative + item.value / 2) / total * 360;
    cumulative += item.value;
    const angle = degrees * Math.PI / 180;
    const left = Math.cos(angle) < 0;
    return {
      ...item, index, left, x: compact ? 28 : left ? 24 : width - 24 - labelWidth,
      y: 0, width: labelWidth, height: Math.max(48, measurements.heights?.[index] ?? 68),
      anchorOffset: (measurements.nameHeights?.[index] ?? 40) / 2,
      start: { x: width / 2 + Math.cos(angle) * radius, y: -Math.sin(angle) * radius },
      end: { x: 0, y: 0 }, path: '', leaderPoints: [] as Point[]
    };
  });
  const sides = [true, false].map((left) => callouts.filter((label) => label.left === left));
  const gap = compact ? 22 : 20;
  const height = compact
    ? radius * 2 + 84 + callouts.reduce((sum, label) => sum + label.height + gap, 0)
    : Math.max(500, radius * 2 + 100, ...sides.map((side) => side.reduce((sum, label) => sum + label.height + gap, 28) + 28));
  const cy = compact ? radius + 24 : height / 2;
  let nextCompactY = radius * 2 + 70;

  for (const side of sides) {
    // Keep label ordering stable; crowded fans fall back to a common spine below.
    side.sort((a, b) => compact ? b.start.y - a.start.y : a.start.y - b.start.y);
    let nextY = 24;
    for (const label of side) {
      label.y = compact ? nextCompactY : Math.max(nextY, cy + label.start.y - label.height / 2);
      nextY = label.y + label.height + gap;
      if (compact) nextCompactY = nextY;
    }
    if (!compact) {
      let bottom = height - 24;
      for (const label of [...side].reverse()) {
        label.y = Math.min(label.y, bottom - label.height);
        bottom = label.y - gap;
      }
    }
    side.forEach((label, order) => {
      label.start.y += cy;
      label.end = {
        x: compact ? label.left ? 16 : width - 16 : label.left ? label.x + label.width + 12 : label.x - 12,
        y: label.y + label.anchorOffset
      };
      const { start, end } = label;
      if (compact) {
        const inset = 14 - order * 10 / Math.max(1, side.length - 1);
        const lane = label.left ? inset : width - inset;
        const direction = label.left ? 1 : -1;
        const topCorner = Math.min(8, Math.abs(start.x - lane) / 2);
        const bottomCorner = Math.min(6, Math.abs(end.x - lane) / 2);
        label.path = `M ${start.x} ${start.y} H ${lane + direction * topCorner} Q ${lane} ${start.y} ${lane} ${start.y + topCorner} V ${end.y - bottomCorner} Q ${lane} ${end.y} ${lane + direction * bottomCorner} ${end.y} H ${end.x}`;
      } else {
        const first = { x: start.x + (start.x - width / 2) / radius * 28, y: start.y + (start.y - cy) / radius * 28 };
        const second = { x: end.x + (label.left ? 20 : -20), y: end.y };
        label.path = `M ${start.x} ${start.y} C ${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`;
        label.leaderPoints = sampleCurve(start, first, second, end);
      }
    });
    if (!compact && (side.length > 12 || leadersCross(side.map((label) => label.leaderPoints))
      || side.some((label) => label.leaderPoints.some((point) => Math.hypot(point.x - width / 2, point.y - cy) < radius - 0.1)))) {
      for (const label of side) {
        const { start, end } = label;
        const spine = { x: width / 2 + (label.left ? -1 : 1) * (radius + 24), y: start.y };
        const control = (spine.x + end.x) / 2;
        label.path = `M ${start.x} ${start.y} H ${spine.x} C ${control} ${start.y} ${control} ${end.y} ${end.x} ${end.y}`;
        label.leaderPoints = [start, ...sampleCurve(spine, { x: control, y: start.y }, { x: control, y: end.y }, end)];
      }
    }
  }
  return { width, height, radius, cx: width / 2, cy, compact, callouts };
};

