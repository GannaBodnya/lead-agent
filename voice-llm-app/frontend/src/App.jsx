import { useState, useRef, useCallback } from 'react'
import {
  Header,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
  Content,
  Tag,
  Button,
  TextArea,
  InlineLoading,
  ToastNotification,
} from '@carbon/react'
import { Microphone, MicrophoneOff, Send, VolumeMuteFilled } from '@carbon/icons-react'
import { useSpeechToText } from './useSpeech'
import { sendMessageStream } from './api'
import Avatar from './Avatar'

const ROLES = { USER: 'user', ASSISTANT: 'assistant' }

export default function App() {
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sttError, setSttError] = useState(null)
  const [avatarSpeaking, setAvatarSpeaking] = useState(false)
  const streamingContentRef = useRef('')
  const messagesEndRef = useRef(null)
  const avatarRef = useRef(null)

  const handleSpeechResult = useCallback((transcript) => {
    setInputText(transcript)
  }, [])

  const {
    listening,
    startListening,
    stopListening,
    error: recognitionError,
  } = useSpeechToText({ onResult: handleSpeechResult })

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const speakResponse = useCallback((text) => {
    if (avatarRef.current) {
      setAvatarSpeaking(true)
      avatarRef.current.speak(text)
      // Poll until avatar finishes speaking
      const poll = setInterval(() => {
        if (!avatarRef.current?.isSpeaking()) {
          setAvatarSpeaking(false)
          clearInterval(poll)
        }
      }, 500)
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    avatarRef.current?.stop()
    setAvatarSpeaking(false)
  }, [])

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg = { role: ROLES.USER, content: trimmed }
    setMessages((prev) => [...prev, userMsg])
    setInputText('')
    setLoading(true)
    streamingContentRef.current = ''

    setMessages((prev) => [...prev, { role: ROLES.ASSISTANT, content: '' }])

    await sendMessageStream({
      message: trimmed,
      history: messages,
      onChunk: (chunk) => {
        streamingContentRef.current += chunk
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: ROLES.ASSISTANT,
            content: streamingContentRef.current,
          }
          return updated
        })
        scrollToBottom()
      },
      onDone: () => {
        setLoading(false)
        speakResponse(streamingContentRef.current)
        scrollToBottom()
      },
      onError: (errMsg) => {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: ROLES.ASSISTANT,
            content: `Error: ${errMsg}`,
          }
          return updated
        })
        setLoading(false)
      },
    })
  }, [messages, loading, speakResponse])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  const handleMicClick = () => {
    if (listening) {
      stopListening()
    } else {
      setSttError(null)
      startListening()
    }
  }

  const error = recognitionError || sttError

  return (
    <div className="app-shell">
      {/* ── Top navigation bar ── */}
      <Header aria-label="Voice LLM Chat">
        <HeaderName prefix="IBM">Voice Agent</HeaderName>
        <HeaderGlobalBar>
          {avatarSpeaking && (
            <HeaderGlobalAction
              aria-label="Stop speaking"
              onClick={stopSpeaking}
              tooltipAlignment="end"
            >
              <VolumeMuteFilled size={20} />
            </HeaderGlobalAction>
          )}
        </HeaderGlobalBar>
      </Header>

      <Content className="chat-content">
        {/* ── Error toast ── */}
        {error && (
          <ToastNotification
            kind="warning"
            title="Speech error"
            subtitle={error}
            onClose={() => setSttError(null)}
            className="error-toast"
            timeout={5000}
          />
        )}

        <div className="main-layout">
          {/* ── Avatar panel ── */}
          <div className="avatar-panel">
            <Avatar ref={avatarRef} />
          </div>

          {/* ── Chat panel ── */}
          <div className="chat-panel">
            <div className="messages-container">
              {messages.length === 0 && (
                <div className="empty-state">
                  <p className="empty-state__title">LEAD AI Co-Panelist</p>
                  <p className="empty-state__subtitle">
                    Press the microphone button or type a message to start the conversation.
                  </p>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx} className={`message-row message-row--${msg.role}`}>
                  <div className={`message-bubble message-bubble--${msg.role}`}>
                    <Tag
                      type={msg.role === ROLES.USER ? 'blue' : 'purple'}
                      size="sm"
                      className="message-tag"
                    >
                      {msg.role === ROLES.USER ? 'You' : 'Agent'}
                    </Tag>
                    <p className="message-text">
                      {msg.content || <span className="typing-cursor">▌</span>}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* ── Input bar ── */}
            <div className="input-bar">
              <Button
                kind={listening ? 'danger' : 'ghost'}
                size="lg"
                iconDescription={listening ? 'Stop recording' : 'Start voice input'}
                hasIconOnly
                renderIcon={listening ? MicrophoneOff : Microphone}
                onClick={handleMicClick}
                className="mic-button"
              />

              <TextArea
                id="chat-input"
                labelText=""
                hideLabel
                placeholder={listening ? 'Listening…' : 'Type a message or use the mic… (Enter to send)'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                rows={1}
                className="chat-textarea"
              />

              {loading ? (
                <InlineLoading
                  description="Thinking…"
                  className="loading-indicator"
                />
              ) : (
                <Button
                  kind="primary"
                  size="lg"
                  iconDescription="Send message"
                  hasIconOnly
                  renderIcon={Send}
                  onClick={() => sendMessage(inputText)}
                  disabled={!inputText.trim()}
                  className="send-button"
                />
              )}
            </div>
          </div>
        </div>
      </Content>
    </div>
  )
}
