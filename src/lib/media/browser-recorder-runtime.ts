import type { SubmissionRecordingMode } from "@/lib/media/submission-recorder";

type MediaDevicesRecorderPort = Pick<
  MediaDevices,
  "getUserMedia" | "getDisplayMedia"
>;

type MediaRecorderConstructor = {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
};

export function stopBrowserRecordingStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

export function browserRecordingConstraints(
  mode: SubmissionRecordingMode,
  includeSystemAudio: boolean,
) {
  if (mode === "screen") {
    return {
      display: {
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: includeSystemAudio,
        systemAudio: includeSystemAudio ? "include" : "exclude",
      } as DisplayMediaStreamOptions,
    } as const;
  }
  return {
    user: {
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video:
        mode === "video"
          ? {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              facingMode: "user",
            }
          : false,
    } as MediaStreamConstraints,
  } as const;
}

export async function requestBrowserRecording(input: {
  mode: SubmissionRecordingMode;
  includeSystemAudio: boolean;
  mimeType: string;
  mediaDevices: MediaDevicesRecorderPort;
  MediaRecorderClass: MediaRecorderConstructor;
}) {
  const constraints = browserRecordingConstraints(
    input.mode,
    input.includeSystemAudio,
  );
  const stream =
    "display" in constraints
      ? await input.mediaDevices.getDisplayMedia(constraints.display)
      : await input.mediaDevices.getUserMedia(constraints.user);
  try {
    let recorder: MediaRecorder;
    try {
      recorder = new input.MediaRecorderClass(stream, {
        mimeType: input.mimeType,
        audioBitsPerSecond: 128_000,
        ...(input.mode === "audio"
          ? {}
          : { videoBitsPerSecond: 2_500_000 }),
      });
    } catch {
      recorder = new input.MediaRecorderClass(stream, {
        mimeType: input.mimeType,
      });
    }
    return { stream, recorder };
  } catch (error) {
    stopBrowserRecordingStream(stream);
    throw error;
  }
}
