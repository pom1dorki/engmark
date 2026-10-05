import { useCallback, useEffect, useState } from "react"
import { canSpeak, initVoices, speakWord, stopSpeaking } from "../study/speak"

export function useSpeech() {
  const speechOn = canSpeak()
  const [speaking, setSpeaking] = useState(false)
  const [speechLive, setSpeechLive] = useState("")

  const halt = useCallback(() => {
    stopSpeaking()
    setSpeaking(false)
    setSpeechLive("")
  }, [])

  useEffect(() => {
    initVoices()
  }, [])

  useEffect(() => {
    function stop() {
      stopSpeaking()
      setSpeaking(false)
    }
    function onHide() {
      if (document.visibilityState === "hidden") stop()
    }
    window.addEventListener("pagehide", stop)
    document.addEventListener("visibilitychange", onHide)
    return () => {
      window.removeEventListener("pagehide", stop)
      document.removeEventListener("visibilitychange", onHide)
      stopSpeaking()
    }
  }, [])

  const pronounce = useCallback((word: string) => {
    if (!speechOn) return
    setSpeechLive(`Произносится: ${word}`)
    speakWord(word, (active) => {
      setSpeaking(active)
      if (!active) setSpeechLive("")
    })
  }, [speechOn])

  return { speechOn, speaking, speechLive, pronounce, halt }
}
