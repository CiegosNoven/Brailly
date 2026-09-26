import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SpeechController } from "./speech-controller";
export type {
  SpeechContent,
  SpeechProvider,
  SpeechState,
} from "./speech-controller";

export function useSpeech({ apiBase }: { apiBase: string }) {
  // The API origin is fixed for the mounted web or extension reader.
  const [controller] = useState(() => new SpeechController(apiBase));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => () => controller.stop(), [controller]);
  const actions = useMemo(
    () => ({
      speak: controller.speak,
      stop: controller.stop,
      setProvider: controller.setProvider,
      retryPlay: controller.retryPlay,
    }),
    [controller],
  );
  return { ...state, ...actions };
}
