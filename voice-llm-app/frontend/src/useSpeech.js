/**
 * useSpeech.js
 * Hooks for Speech-to-Text (Web Speech API) and Text-to-Speech (Web Speech API).
 * Both APIs are built into all modern browsers — no external library needed.
 */

import { useState, useRef, useCallback } from 'react'

// ---------------------------------------------------------------------------
// useSpeechToText
// Returns: { transcript, listening, startListening, stopListening, error }
// ---------------------------------------------------------------------------
export function useSpeechToText({ onResult } = {}) {
  const [transcript, setTranscript] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)

  const startListening = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setError('SpeechRecognition is not supported in this browser. Use Chrome or Edge.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setListening(true)
      setError(null)
      setTranscript('')
    }

    recognition.onresult = (event) => {
      const result = event.results[0][0].transcript
      setTranscript(result)
      if (onResult) onResult(result)
    }

    recognition.onerror = (event) => {
      setError(`Speech recognition error: ${event.error}`)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [onResult])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  return { transcript, listening, startListening, stopListening, error }
}

// ---------------------------------------------------------------------------
// useTextToSpeech
// Returns: { speak, speaking, cancel }
// ---------------------------------------------------------------------------
function pickVoice() {
  const voices = window.speechSynthesis.getVoices()
  return voices.find(v => v.name === 'Google UK English Female')
    ?? voices.find(v => v.lang === 'en-GB')
    ?? null
}

export function useTextToSpeech() {
  const [speaking, setSpeaking] = useState(false)

  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-GB'
    utterance.rate = 1.0
    utterance.pitch = 1.0

    // getVoices() may be empty on first call in Chrome — wait for voiceschanged
    const doSpeak = () => {
      const voice = pickVoice()
      if (voice) utterance.voice = voice
      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(utterance)
    }

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak()
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true })
    }
  }, [])

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  return { speak, speaking, cancel }
}
