import type { PerformancePlanParams } from "../performance";
import { importPerformancePlanFromEdl } from "./edl";
import { importPerformancePlanFromOtio } from "./otio";
import { importPerformancePlanFromPremiereXml } from "./premiereXml";

export type EditorialExchangeFormat = "otio" | "premiere_xml" | "cmx3600_edl";

export interface EditorialTimingImportOptions {
  basePlan: PerformancePlanParams;
  durationFrames: number;
  fps: number;
}

export interface EditorialTimingImportResult {
  ok: boolean;
  format: EditorialExchangeFormat;
  performancePlan?: PerformancePlanParams;
  fps?: number;
  issues: string[];
  warnings: string[];
}

const formatFromFile = (fileName: string, text: string): EditorialExchangeFormat => {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".xml") || text.trimStart().startsWith("<")) {
    return "premiere_xml";
  }
  if (normalized.endsWith(".edl") || /^TITLE:/im.test(text)) {
    return "cmx3600_edl";
  }
  return "otio";
};

export const importEditorialTimingFile = (
  fileName: string,
  text: string,
  options: EditorialTimingImportOptions,
): EditorialTimingImportResult => {
  const format = formatFromFile(fileName, text);
  if (format === "premiere_xml") {
    return { format, ...importPerformancePlanFromPremiereXml(text, options) };
  }
  if (format === "cmx3600_edl") {
    return { format, ...importPerformancePlanFromEdl(text, options) };
  }
  try {
    const result = importPerformancePlanFromOtio(JSON.parse(text));
    return { format, ...result, warnings: [] };
  } catch (error) {
    return {
      ok: false,
      format,
      issues: [error instanceof Error ? error.message : "Could not parse the OTIO document."],
      warnings: [],
    };
  }
};

