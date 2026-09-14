/**
 * api.js
 * Handles communication with the FastAPI backend.
 * Supports both streaming (SSE) and non-streaming responses.
 */

const API_BASE = '/api'

/**
 * Send a message to the backend and stream the response token by token.
 * @param {string} message - The user's message text
 * @param {Array}  history - Prior conversation messages [{role, content}, ...]
 * @param {function} onChunk - Called for each streamed text chunk
 * @param {function} onDone  - Called when the stream ends
 * @param {function} onError - Called on error
 */
export async function sendMessageStream({ message, history, onChunk, onDone, onError }) {
  try {
    const response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ message, history }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
      throw new Error(err.detail || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let finished = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') {
            finished = true
            onDone?.()
            return
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.chunk) onChunk?.(parsed.chunk)
            if (parsed.error) throw new Error(parsed.error)
          } catch (e) {
            if (e instanceof SyntaxError) continue // ignore malformed SSE lines
            throw e
          }
        }
      }
    }
    if (!finished) onDone?.()
  } catch (err) {
    onError?.(err.message)
  }
}
