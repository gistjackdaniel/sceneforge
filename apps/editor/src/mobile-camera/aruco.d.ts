declare module "js-aruco2" {
  export namespace AR {
    class Detector {
      constructor(options: { dictionaryName: string; maxHammingDistance: number });
      detect(image: ImageData): { id: number; corners: { x: number; y: number }[] }[];
    }
  }
}

declare module "js-aruco2/src/posit1.js" {
  export namespace POS {
    class Posit {
      constructor(markerSize: number, focalLength: number);
      pose(corners: { x: number; y: number }[]): {
        bestError: number;
        bestRotation: number[][];
        bestTranslation: number[];
      };
    }
  }
}
