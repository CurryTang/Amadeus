import { useState, useRef, useCallback } from 'react';
import { Button } from '@radix-ui/themes';

export default function AudioRecorder({ apiUrl, getAuthHeaders, onTranscription }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) return;

        setTranscribing(true);
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'audio.webm');

          const headers = getAuthHeaders();
          // Remove Content-Type so browser sets multipart boundary
          delete headers['Content-Type'];

          const response = await fetch(`${apiUrl}/session-mirror/transcribe`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            if (onTranscription) onTranscription(data.refinedPrompt || data.text || '');
          } else {
            console.error('Transcription failed:', await response.text());
          }
        } catch (err) {
          console.error('Transcription error:', err);
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [apiUrl, getAuthHeaders, onTranscription]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setRecording(false);
  }, []);

  return (
    <Button
      size="1"
      variant={recording ? 'solid' : 'soft'}
      color={recording ? 'red' : 'gray'}
      disabled={transcribing}
      onClick={recording ? stopRecording : startRecording}
      style={{ minWidth: '36px' }}
    >
      {transcribing ? '...' : recording ? '⏹' : '🎤'}
    </Button>
  );
}
