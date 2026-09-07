export const downloadTextFile = (contents: string, filename: string, mimeType: string): void => {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const editorialFilename = (clipName: string, extension: string): string => {
  const baseName = clipName.replace(/[^a-z0-9_-]+/gi, "-") || "sceneforge-direction";
  return `${baseName}.${extension}`;
};
