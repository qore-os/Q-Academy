import {
  isIsoBmffMimeType,
  IsoBmffStreamValidator,
} from "@/lib/media/iso-bmff-validator";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";
import {
  isMetadataDurationMimeType,
  MetadataDurationStreamValidator,
} from "@/lib/media/metadata-duration-validator";
import {
  isOoxmlMimeType,
  OoxmlStreamValidator,
} from "@/lib/media/ooxml-validator";
import {
  isWavMimeType,
  WavStreamValidator,
} from "@/lib/media/wav-validator";

export type MediaStructuredContentValidator = Readonly<{
  observe(chunk: Uint8Array): void | Promise<void>;
  finalize(): Promise<MediaStructuredContentInspection | void>;
}>;

export type MediaStructuredContentInspection = Readonly<{
  durationMilliseconds: number | null;
}>;

export function createMediaStructuredContentValidator(
  mimeType: AllowedMediaMimeType,
  expectedSizeBytes: number,
): MediaStructuredContentValidator | null {
  if (isOoxmlMimeType(mimeType)) {
    return new OoxmlStreamValidator(mimeType, expectedSizeBytes);
  }
  if (isIsoBmffMimeType(mimeType)) {
    return new IsoBmffStreamValidator(mimeType, expectedSizeBytes);
  }
  if (isWavMimeType(mimeType)) {
    return new WavStreamValidator(expectedSizeBytes);
  }
  if (isMetadataDurationMimeType(mimeType)) {
    return new MetadataDurationStreamValidator(mimeType, expectedSizeBytes);
  }
  return null;
}
