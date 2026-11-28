export const TRACKING_MARKER = {
  dictionary: "ARUCO_MIP_36h12",
  id: 0,
  bits: "110100101011011000111010000010011101",
  dataCells: 6,
  totalCells: 10,
} as const;

export const drawTrackingMarker = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { bits, dataCells, totalCells } = TRACKING_MARKER;
  const cell = canvas.width / totalCells;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  context.fillRect(cell, cell, (totalCells - 2) * cell, (totalCells - 2) * cell);
  context.fillStyle = "#fff";
  for (let index = 0; index < bits.length; index++) {
    if (bits[index] === "1") context.fillRect((index % dataCells + 2) * cell, (Math.floor(index / dataCells) + 2) * cell, cell, cell);
  }
};
