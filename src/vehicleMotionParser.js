const DEFAULTS = Object.freeze({
  differenceThreshold: 26,
  cellSize: 4,
  minimumChangedPixelsPerCell: 5,
  minimumComponentCells: 3,
  maximumComponentFraction: 0.42,
  ignoreBottomFraction: 0.12,
  maximumRegions: 48,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function rgbaToLuma(rgba, width, height) {
  const count = Math.max(0, Number(width) * Number(height));
  if (!rgba || rgba.length < count * 4) throw new Error('RGBA frame is incomplete');
  const luma = new Uint8Array(count);
  for (let pixel = 0, offset = 0; pixel < count; pixel += 1, offset += 4) {
    luma[pixel] = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114);
  }
  return luma;
}

function medianBrightnessDelta(previous, current, usablePixels) {
  const histogram = new Uint32Array(511);
  const stride = Math.max(1, Math.floor(usablePixels / 2048));
  let samples = 0;
  for (let index = 0; index < usablePixels; index += stride) {
    histogram[current[index] - previous[index] + 255] += 1;
    samples += 1;
  }
  const midpoint = Math.ceil(samples / 2);
  let accumulated = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    accumulated += histogram[index];
    if (accumulated >= midpoint) return index - 255;
  }
  return 0;
}

/**
 * Deterministic frame differencing. It finds connected regions of changed
 * pixels; it does not infer identity, read text, or call a model or API.
 */
export function detectMotionRegions(previous, current, width, height, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const frameWidth = Math.floor(Number(width));
  const frameHeight = Math.floor(Number(height));
  const pixelCount = frameWidth * frameHeight;
  if (frameWidth < 16 || frameHeight < 16 || previous?.length !== pixelCount || current?.length !== pixelCount) {
    throw new Error('Motion frames must have identical valid dimensions');
  }
  const usableHeight = Math.max(1, Math.floor(frameHeight * (1 - clamp(config.ignoreBottomFraction, 0, 0.4))));
  const usablePixels = usableHeight * frameWidth;
  const brightnessDelta = medianBrightnessDelta(previous, current, usablePixels);
  const cellSize = Math.max(2, Math.floor(config.cellSize));
  const columns = Math.ceil(frameWidth / cellSize);
  const rows = Math.ceil(usableHeight / cellSize);
  const active = new Uint8Array(columns * rows);
  const strengths = new Float32Array(columns * rows);

  for (let cellY = 0; cellY < rows; cellY += 1) {
    for (let cellX = 0; cellX < columns; cellX += 1) {
      let changed = 0;
      let strength = 0;
      let sampled = 0;
      const yEnd = Math.min(usableHeight, (cellY + 1) * cellSize);
      const xEnd = Math.min(frameWidth, (cellX + 1) * cellSize);
      for (let y = cellY * cellSize; y < yEnd; y += 1) {
        for (let x = cellX * cellSize; x < xEnd; x += 1) {
          const index = y * frameWidth + x;
          const difference = Math.abs((current[index] - brightnessDelta) - previous[index]);
          if (difference >= config.differenceThreshold) changed += 1;
          strength += difference;
          sampled += 1;
        }
      }
      const cellIndex = cellY * columns + cellX;
      if (changed >= Math.min(sampled, config.minimumChangedPixelsPerCell)) active[cellIndex] = 1;
      strengths[cellIndex] = sampled ? strength / sampled : 0;
    }
  }

  const visited = new Uint8Array(active.length);
  const regions = [];
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let seed = 0; seed < active.length; seed += 1) {
    if (!active[seed] || visited[seed]) continue;
    const queue = [seed];
    visited[seed] = 1;
    let head = 0;
    let minX = columns;
    let minY = rows;
    let maxX = 0;
    let maxY = 0;
    let cells = 0;
    let strengthTotal = 0;
    while (head < queue.length) {
      const index = queue[head++];
      const x = index % columns;
      const y = Math.floor(index / columns);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      cells += 1;
      strengthTotal += strengths[index];
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) continue;
        const next = nextY * columns + nextX;
        if (active[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    const fraction = cells / (columns * rows);
    if (cells < config.minimumComponentCells || fraction > config.maximumComponentFraction) continue;
    regions.push({
      bbox: [
        clamp((minY * cellSize) / frameHeight, 0, 1),
        clamp((minX * cellSize) / frameWidth, 0, 1),
        clamp(((maxY + 1) * cellSize) / frameHeight, 0, 1),
        clamp(((maxX + 1) * cellSize) / frameWidth, 0, 1),
      ],
      confidence: clamp((strengthTotal / cells - config.differenceThreshold) / 80 + 0.35, 0.35, 0.98),
      changedCells: cells,
    });
  }
  return regions.sort((left, right) => right.changedCells - left.changedCells).slice(0, config.maximumRegions);
}
