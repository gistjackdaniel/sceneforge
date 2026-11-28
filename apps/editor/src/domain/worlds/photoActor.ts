export const PHOTO_ACTOR_ENDPOINT = "/api/photo-avatar";
export const PHOTO_ACTOR_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const PHOTO_ACTOR_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type PhotoActorImageMime = typeof PHOTO_ACTOR_IMAGE_MIMES[number];

export const isPhotoActorImageMime = (value: string): value is PhotoActorImageMime =>
  PHOTO_ACTOR_IMAGE_MIMES.some((mime) => mime === value);

export const importedActorUri = (sha256: string): string => `actors/imported/${sha256}.glb`;

export const importedActorHash = (uri: string): string | undefined =>
  /^actors\/imported\/([a-f0-9]{64})\.glb$/.exec(uri)?.[1];
