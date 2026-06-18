'use client'

import { useEffect, useRef } from 'react'
import { markScoresSeen } from '@/actions/submissions'

// Fires once on mount to mark the student's scores as seen — the home page has just
// shown the「new score」highlights, so the unread dot/badge can clear on next view.
export function MarkScoresSeen() {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void markScoresSeen()
  }, [])
  return null
}
