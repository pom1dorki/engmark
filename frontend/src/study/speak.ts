let voices: SpeechSynthesisVoice[] = []
let cachedVoice: SpeechSynthesisVoice | null = null
let voicesReady = false
let generation = 0

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

function pickEnglishVoice() {
  const english = voices.filter((voice) => /^en(-|_)/i.test(voice.lang) || /english/i.test(voice.name))
  return (
    english.find((voice) => /en-US/i.test(voice.lang) && /google|premium|enhanced|natural/i.test(voice.name)) ||
    english.find((voice) => /en-US/i.test(voice.lang)) ||
    english[0] ||
    null
  )
}

function loadVoices() {
  if (!canSpeak()) return
  voices = window.speechSynthesis.getVoices()
  if (voices.length) cachedVoice = pickEnglishVoice()
}

export function initVoices() {
  if (!canSpeak() || voicesReady) return
  voicesReady = true
  loadVoices()

  let tries = 0
  const retry = () => {
    if (voices.length || tries > 20) return
    tries += 1
    loadVoices()
    window.setTimeout(retry, 100)
  }
  if (!voices.length) window.setTimeout(retry, 100)

  const synth = window.speechSynthesis
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", loadVoices)
  } else {
    synth.onvoiceschanged = loadVoices
  }
}

export function stopSpeaking() {
  generation += 1
  if (canSpeak()) window.speechSynthesis.cancel()
}

export function speakWord(word: string, onSpeaking: (speaking: boolean) => void) {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  const token = ++generation
  synth.cancel()
  onSpeaking(false)

  const utter = new SpeechSynthesisUtterance(word)
  utter.lang = "en-US"
  utter.rate = 0.9
  const voice = cachedVoice || pickEnglishVoice()
  if (voice) {
    utter.voice = voice
    cachedVoice = voice
  }

  const done = () => {
    if (token !== generation) return
    onSpeaking(false)
  }
  utter.onend = done
  utter.onerror = done
  onSpeaking(true)
  synth.speak(utter)
}
