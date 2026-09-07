export interface PlyVertex {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  opacity: number;
  scale: [number, number, number];
  rotation: [number, number, number, number];
  hasGaussian: boolean;
}

export interface ParsedPly {
  vertices: PlyVertex[];
}

const SH_C0 = 0.28209479177387814;

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const TYPE_SIZE: Record<string, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

interface PlyProperty {
  name: string;
  type: string;
}

const readNumeric = (view: DataView, offset: number, type: string, littleEndian: boolean): number => {
  switch (type) {
    case "char":
    case "int8":
      return view.getInt8(offset);
    case "uchar":
    case "uint8":
      return view.getUint8(offset);
    case "short":
    case "int16":
      return view.getInt16(offset, littleEndian);
    case "ushort":
    case "uint16":
      return view.getUint16(offset, littleEndian);
    case "int":
    case "int32":
      return view.getInt32(offset, littleEndian);
    case "uint":
    case "uint32":
      return view.getUint32(offset, littleEndian);
    case "float":
    case "float32":
      return view.getFloat32(offset, littleEndian);
    case "double":
    case "float64":
      return view.getFloat64(offset, littleEndian);
    default:
      throw new Error(`Unsupported PLY property type: ${type}`);
  }
};

const vertexFromRecord = (record: Record<string, number>): PlyVertex => {
  const hasGaussian = "f_dc_0" in record || "scale_0" in record;
  let r = 1;
  let g = 1;
  let b = 1;
  if ("red" in record || "r" in record) {
    const rawR = record.red ?? record.r;
    r = rawR > 1 ? rawR / 255 : rawR;
    const rawG = record.green ?? record.g ?? rawR;
    g = rawG > 1 ? rawG / 255 : rawG;
    const rawB = record.blue ?? record.b ?? rawR;
    b = rawB > 1 ? rawB / 255 : rawB;
  } else if ("f_dc_0" in record) {
    r = clamp01(0.5 + SH_C0 * record.f_dc_0);
    g = clamp01(0.5 + SH_C0 * (record.f_dc_1 ?? 0));
    b = clamp01(0.5 + SH_C0 * (record.f_dc_2 ?? 0));
  }
  const opacity = "opacity" in record ? clamp01(sigmoid(record.opacity)) : 1;
  const scale: [number, number, number] = hasGaussian
    ? [
        Math.exp(record.scale_0 ?? -2.5),
        Math.exp(record.scale_1 ?? record.scale_0 ?? -2.5),
        Math.exp(record.scale_2 ?? record.scale_0 ?? -2.5),
      ]
    : [0.04, 0.04, 0.04];
  const rotation: [number, number, number, number] = [
    record.rot_0 ?? 1,
    record.rot_1 ?? 0,
    record.rot_2 ?? 0,
    record.rot_3 ?? 0,
  ];
  return {
    x: record.x ?? 0,
    y: record.y ?? 0,
    z: record.z ?? 0,
    r,
    g,
    b,
    opacity,
    scale,
    rotation,
    hasGaussian,
  };
};

const parseHeader = (
  text: string,
): { format: "ascii" | "binary_le" | "binary_be"; vertexCount: number; properties: PlyProperty[]; headerLength: number } => {
  const headerEnd = text.indexOf("end_header");
  if (headerEnd < 0) {
    throw new Error("PLY header is missing end_header.");
  }
  const header = text.slice(0, headerEnd);
  const lines = header.split(/\r?\n/).map((line) => line.trim());
  const formatLine = lines.find((line) => line.startsWith("format "));
  if (!formatLine) {
    throw new Error("PLY header is missing format.");
  }
  const format = formatLine.includes("ascii")
    ? "ascii"
    : formatLine.includes("binary_little_endian")
      ? "binary_le"
      : "binary_be";
  const vertexLine = lines.find((line) => line.startsWith("element vertex "));
  const vertexCount = Number(vertexLine?.split(/\s+/)[2] ?? 0);
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
    throw new Error("PLY has no vertices.");
  }
  const properties: PlyProperty[] = [];
  let inVertex = false;
  for (const line of lines) {
    if (line.startsWith("element vertex ")) {
      inVertex = true;
      continue;
    }
    if (line.startsWith("element ")) {
      inVertex = false;
      continue;
    }
    if (inVertex && line.startsWith("property ")) {
      const parts = line.split(/\s+/);
      if (parts[1] === "list") {
        continue;
      }
      properties.push({ type: parts[1], name: parts[2] });
    }
  }
  if (!properties.some((item) => item.name === "x")) {
    throw new Error("PLY vertices are missing x/y/z.");
  }
  const headerLength = text.indexOf("\n", headerEnd) + 1;
  return { format, vertexCount, properties, headerLength };
};

const parseAsciiVertices = (body: string, properties: PlyProperty[], vertexCount: number): PlyVertex[] => {
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const vertices: PlyVertex[] = [];
  for (let i = 0; i < vertexCount && i < lines.length; i += 1) {
    const values = lines[i].trim().split(/\s+/);
    const record: Record<string, number> = {};
    properties.forEach((property, index) => {
      record[property.name] = Number(values[index]);
    });
    vertices.push(vertexFromRecord(record));
  }
  return vertices;
};

const parseBinaryVertices = (
  bytes: Uint8Array,
  offset: number,
  properties: PlyProperty[],
  vertexCount: number,
  littleEndian: boolean,
): PlyVertex[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stride = properties.reduce((sum, property) => sum + (TYPE_SIZE[property.type] ?? 0), 0);
  if (stride <= 0 || offset + stride * vertexCount > bytes.byteLength) {
    throw new Error("PLY binary payload is truncated.");
  }
  const vertices: PlyVertex[] = [];
  let cursor = offset;
  for (let i = 0; i < vertexCount; i += 1) {
    const record: Record<string, number> = {};
    for (const property of properties) {
      record[property.name] = readNumeric(view, cursor, property.type, littleEndian);
      cursor += TYPE_SIZE[property.type];
    }
    vertices.push(vertexFromRecord(record));
  }
  return vertices;
};

/**
 * Parse ASCII or binary vertex-only PLY used for point-cloud / 3DGS viewport previews.
 */
export const parsePly = (source: ArrayBuffer | string): ParsedPly => {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : new Uint8Array(source);
  const headerText = new TextDecoder("utf-8").decode(bytes.subarray(0, Math.min(bytes.byteLength, 65536)));
  const header = parseHeader(headerText);
  const vertices =
    header.format === "ascii"
      ? parseAsciiVertices(new TextDecoder("utf-8").decode(bytes).slice(header.headerLength), header.properties, header.vertexCount)
      : parseBinaryVertices(bytes, header.headerLength, header.properties, header.vertexCount, header.format === "binary_le");
  if (vertices.length === 0) {
    throw new Error("PLY has no vertices.");
  }
  return { vertices };
};
