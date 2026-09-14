/**
 * Avatar.jsx
 * TalkingHead.js avatar component.
 * Renders a Ready Player Me 3D avatar that lip-syncs to TTS audio.
 *
 * The TTS endpoint is our own FastAPI proxy (/api/tts) — OpenAI API key
 * never touches the browser.
 */

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { TalkingHead } from '@met4citizen/talkinghead'
import { InlineLoading } from '@carbon/react'
import { useState } from 'react'

// Ready Player Me avatar URL — morphTargets required for lip-sync
const AVATAR_URL =
  'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb' +
  '?morphTargets=ARKit,Oculus%20Visemes'

// TTS proxy endpoint on our backend
const TTS_ENDPOINT = '/api/tts'

/**
 * Avatar component.
 * Exposes a `speak(text)` method via ref:
 *   const avatarRef = useRef()
 *   avatarRef.current.speak("Hello!")
 */
const Avatar = forwardRef(function Avatar(_props, ref) {
  const containerRef = useRef(null)
  const headRef = useRef(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'

  // Expose speak() and stop() to parent via ref
  useImperativeHandle(ref, () => ({
    speak: (text) => {
      if (headRef.current && status === 'ready') {
        headRef.current.speakText(text)
      }
    },
    stop: () => {
      headRef.current?.stopSpeaking?.()
    },
    isSpeaking: () => {
      return headRef.current?.isSpeaking?.() ?? false
    },
  }), [status])

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    async function init() {
      try {
        const head = new TalkingHead(containerRef.current, {
          // Point TalkingHead at our backend TTS proxy
          ttsEndpoint: TTS_ENDPOINT,
          ttsModel: 'tts-1',
          ttsVoice: 'nova',
          ttsLang: 'en-GB',
          // Rendering options
          cameraView: 'upper',
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
        })

        headRef.current = head

        await head.showAvatar({
          url: AVATAR_URL,
          body: 'F',
          avatarMood: 'neutral',
          ttsVoice: 'nova',
        })

        if (!disposed) setStatus('ready')
      } catch (err) {
        if (!disposed) {
          console.error('TalkingHead init failed:', err)
          setStatus('error')
        }
      }
    }

    init()

    return () => {
      disposed = true
      headRef.current?.stopSpeaking?.()
      headRef.current = null
    }
  }, [])

  return (
    <div className="avatar-wrapper">
      {status === 'loading' && (
        <div className="avatar-loading">
          <InlineLoading description="Loading avatar…" />
        </div>
      )}
      {status === 'error' && (
        <div className="avatar-error">
          <p>Avatar unavailable</p>
        </div>
      )}
      <div
        ref={containerRef}
        className="avatar-canvas"
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
      />
    </div>
  )
})

export default Avatar
